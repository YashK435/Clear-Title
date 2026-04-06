// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ══════════════════════════════════════════════════════════════
//  ClearTitle — Blockchain Land Registry
//  Version 3.0
//
//  Changes from v2:
//    [A] Commit-reveal transfer removed — single initiateTransfer()
//    [B] agreedSaleValueINR added to transfer (registrar cross-check)
//    [C] TransferRecord struct stores buyer + agreedValue + expiry cleanly
//    [D] All other v2 fixes retained (reentrancy, timelock, disputes, etc.)
// ══════════════════════════════════════════════════════════════

contract LandRegistry {

    // ─────────────────────────────────────────────
    //  REENTRANCY GUARD
    // ─────────────────────────────────────────────
    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "Reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ─────────────────────────────────────────────
    //  ROLES
    // ─────────────────────────────────────────────
    address public admin;
    address public registrar;
    address public surveyor;
    address public disputeOfficer;

    uint256 public constant ROLE_TIMELOCK = 1 minutes;

    struct RoleProposal {
        address proposedRegistrar;
        address proposedSurveyor;
        address proposedDisputeOfficer;
        address proposedBy;
        uint256 proposedAt;
        bool    exists;
    }
    RoleProposal public pendingRoleProposal;

    // ─────────────────────────────────────────────
    //  ENUMS
    // ─────────────────────────────────────────────
    enum Status {
        Pending,      // 0
        Verified,     // 1
        Rejected,     // 2
        Disputed,     // 3
        UnderReview   // 4
    }

    enum DisputeResult {
        None,        // 0
        Approved,    // 1
        Rejected,    // 2
        PartialFix   // 3
    }

    // ─────────────────────────────────────────────
    //  STRUCTS
    // ─────────────────────────────────────────────
    struct PropertyCore {
        uint256 propertyId;
        address owner;
        uint256 areaSqFt;
        uint256 declaredValueINR;
        Status  status;
        bool    isRegistered;
        bool    surveyorApproved;
        bool    registrarApproved;
        DisputeResult disputeResult;
        uint256 parentPropertyId;
        uint256 resubmittedFrom;
    }

    struct PropertyMeta {
        string  location;
        string  unitIdentifier;
        string  ipfsHash;          // points to structured manifest JSON on IPFS
        string  rejectionReason;
        string  disputeNotes;
        int256  latitude;          // stored as int256 * 1e6 to avoid floats
        int256  longitude;
    }

    // [A] Clean transfer record — no commit/reveal fields
    struct TransferRecord {
        address buyer;
        uint256 agreedSaleValueINR;   // [B] seller-declared sale price
        uint256 expiry;               // block.timestamp + 30 days
        bool    registrarApproved;
        bool    active;
    }

    uint256 public constant TRANSFER_VALIDITY = 30 days;

    uint256 public propertyCount;

    mapping(uint256 => PropertyCore)   public core;
    mapping(uint256 => PropertyMeta)   public meta;
    mapping(uint256 => address[])      public ownershipHistory;
    mapping(uint256 => TransferRecord) public transfers;   // [C]
    mapping(uint256 => address)        public disputeRaisedBy;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────
    event PropertyRegistered(uint256 id, address owner, uint256 resubmittedFrom);
    event SurveyorApproved(uint256 id, address surveyorAddr, uint256 timestamp);
    event SurveyorRejected(uint256 id, address surveyorAddr, string reason);
    event RegistrarApproved(uint256 id, address registrarAddr, uint256 timestamp);
    event RegistrarRejected(uint256 id, address registrarAddr, string reason);
    event Disputed(uint256 id, address raisedBy);
    event DisputeResolved(uint256 id, DisputeResult result);
    event DisputeReferred(uint256 id, string notes);
    event TransferInitiated(uint256 id, address buyer, uint256 agreedSaleValueINR, uint256 expiry);
    event TransferCancelled(uint256 id, address cancelledBy);
    event TransferExpired(uint256 id);
    event TransferApprovedByRegistrar(uint256 id);
    event TransferRejectedByRegistrar(uint256 id);
    event OwnershipTransferred(uint256 id, address from, address to, uint256 agreedSaleValueINR);
    event RoleChangeProposed(address registrar, address surveyor, address disputeOfficer, uint256 executeAfter);
    event RolesUpdated(address registrar, address surveyor, address disputeOfficer);
    event RoleProposalCancelled();

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────
    modifier onlyAdmin()          { require(msg.sender == admin,          "Not admin");           _; }
    modifier onlyRegistrar()      { require(msg.sender == registrar,      "Not registrar");       _; }
    modifier onlySurveyor()       { require(msg.sender == surveyor,       "Not surveyor");        _; }
    modifier onlyDisputeOfficer() { require(msg.sender == disputeOfficer, "Not dispute officer"); _; }
    modifier propertyExists(uint256 _id) {
        require(core[_id].propertyId != 0, "Invalid property");
        _;
    }

    // ─────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────
    constructor() {
        admin = msg.sender;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ─────────────────────────────────────────────
    //  ROLES — TIMELOCK
    // ─────────────────────────────────────────────
    function proposeRoles(
        address _registrar,
        address _surveyor,
        address _disputeOfficer
    ) public onlyAdmin {
        require(_registrar      != address(0), "Invalid registrar");
        require(_surveyor       != address(0), "Invalid surveyor");
        require(_disputeOfficer != address(0), "Invalid dispute officer");

        pendingRoleProposal = RoleProposal({
            proposedRegistrar:      _registrar,
            proposedSurveyor:       _surveyor,
            proposedDisputeOfficer: _disputeOfficer,
            proposedBy:             msg.sender,
            proposedAt:             block.timestamp,
            exists:                 true
        });

        emit RoleChangeProposed(
            _registrar,
            _surveyor,
            _disputeOfficer,
            block.timestamp + ROLE_TIMELOCK
        );
    }

    function confirmRoles() public onlyAdmin {
        require(pendingRoleProposal.exists, "No pending proposal");
        require(
            block.timestamp >= pendingRoleProposal.proposedAt + ROLE_TIMELOCK,
            "Timelock not elapsed"
        );
        registrar      = pendingRoleProposal.proposedRegistrar;
        surveyor       = pendingRoleProposal.proposedSurveyor;
        disputeOfficer = pendingRoleProposal.proposedDisputeOfficer;
        delete pendingRoleProposal;
        emit RolesUpdated(registrar, surveyor, disputeOfficer);
    }

    function cancelRoleProposal() public onlyAdmin {
        require(pendingRoleProposal.exists, "No pending proposal");
        delete pendingRoleProposal;
        emit RoleProposalCancelled();
    }

    // ─────────────────────────────────────────────
    //  REGISTER
    // ─────────────────────────────────────────────
    function registerProperty(
        string memory _location,
        string memory _unitIdentifier,
        uint256       _areaSqFt,
        string memory _ipfsHash,
        int256        _latitude,
        int256        _longitude,
        uint256       _parentPropertyId,
        uint256       _resubmittedFrom,
        uint256       _declaredValueINR
    ) public {
        require(_areaSqFt > 0,               "Area must be > 0");
        require(bytes(_location).length > 0, "Location required");
        require(bytes(_ipfsHash).length > 0, "IPFS hash required");
        require(_declaredValueINR > 0,        "Declared value required");

        if (_resubmittedFrom != 0) {
            require(core[_resubmittedFrom].propertyId != 0,          "Linked ID does not exist");
            require(core[_resubmittedFrom].owner == msg.sender,       "Not owner of linked property");
            require(core[_resubmittedFrom].status == Status.Rejected,  "Linked property not rejected");
        }

        if (_parentPropertyId != 0) {
            require(core[_parentPropertyId].propertyId != 0,          "Parent does not exist");
            require(core[_parentPropertyId].status == Status.Verified, "Parent must be verified");
            require(bytes(_unitIdentifier).length > 0,                 "Unit identifier required");
        }

        propertyCount++;
        uint256 id = propertyCount;

        core[id].propertyId       = id;
        core[id].owner            = msg.sender;
        core[id].areaSqFt         = _areaSqFt;
        core[id].declaredValueINR = _declaredValueINR;
        core[id].status           = Status.Pending;
        core[id].disputeResult    = DisputeResult.None;
        core[id].parentPropertyId = _parentPropertyId;
        core[id].resubmittedFrom  = _resubmittedFrom;

        meta[id].location       = _location;
        meta[id].unitIdentifier = _unitIdentifier;
        meta[id].ipfsHash       = _ipfsHash;
        meta[id].latitude       = _latitude;
        meta[id].longitude      = _longitude;

        ownershipHistory[id].push(msg.sender);

        emit PropertyRegistered(id, msg.sender, _resubmittedFrom);
    }

    // ─────────────────────────────────────────────
    //  SURVEYOR
    // ─────────────────────────────────────────────
    function approveBySurveyor(uint256 _id)
        public onlySurveyor propertyExists(_id)
    {
        require(core[_id].status == Status.Pending, "Not pending");
        require(!core[_id].surveyorApproved,         "Already approved");
        core[_id].surveyorApproved = true;
        emit SurveyorApproved(_id, msg.sender, block.timestamp);
    }

    function rejectBySurveyor(uint256 _id, string memory _reason)
        public onlySurveyor propertyExists(_id)
    {
        require(core[_id].status == Status.Pending, "Not pending");
        require(bytes(_reason).length > 0,           "Reason required");
        core[_id].status          = Status.Rejected;
        meta[_id].rejectionReason = _reason;
        emit SurveyorRejected(_id, msg.sender, _reason);
    }

    // ─────────────────────────────────────────────
    //  REGISTRAR — REGISTRATION
    // ─────────────────────────────────────────────
    function approveByRegistrar(uint256 _id)
        public onlyRegistrar propertyExists(_id)
    {
        require(core[_id].status == Status.Pending, "Not pending");
        require(core[_id].surveyorApproved,          "Surveyor must approve first");
        core[_id].registrarApproved = true;
        core[_id].isRegistered      = true;
        core[_id].status            = Status.Verified;
        emit RegistrarApproved(_id, msg.sender, block.timestamp);
    }

    function rejectByRegistrar(uint256 _id, string memory _reason)
        public onlyRegistrar propertyExists(_id)
    {
        require(core[_id].status == Status.Pending, "Not pending");
        require(bytes(_reason).length > 0,           "Reason required");
        core[_id].status          = Status.Rejected;
        meta[_id].rejectionReason = _reason;
        emit RegistrarRejected(_id, msg.sender, _reason);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — SINGLE STEP [A]
    // ─────────────────────────────────────────────

    /// @notice Seller directly initiates transfer. No commit-reveal.
    /// @param _agreedSaleValueINR  Declared sale price — registrar uses this for cross-check.
    function initiateTransfer(
        uint256 _id,
        address _buyer,
        uint256 _agreedSaleValueINR
    ) public propertyExists(_id) {
        require(core[_id].owner == msg.sender,       "Not owner");
        require(core[_id].status == Status.Verified,  "Not verified");
        require(_buyer != address(0),                  "Invalid buyer");
        require(_buyer != msg.sender,                  "Cannot transfer to self");
        require(!transfers[_id].active,                "Transfer already pending");
        require(_agreedSaleValueINR > 0,               "Sale value required");

        uint256 expiry = block.timestamp + TRANSFER_VALIDITY;

        transfers[_id] = TransferRecord({
            buyer:              _buyer,
            agreedSaleValueINR: _agreedSaleValueINR,
            expiry:             expiry,
            registrarApproved:  false,
            active:             true
        });

        emit TransferInitiated(_id, _buyer, _agreedSaleValueINR, expiry);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — REGISTRAR APPROVAL
    // ─────────────────────────────────────────────
    function approveTransferByRegistrar(uint256 _id)
        public onlyRegistrar propertyExists(_id)
    {
        require(transfers[_id].active,              "No pending transfer");
        require(!transfers[_id].registrarApproved,  "Already approved");
        require(block.timestamp <= transfers[_id].expiry, "Transfer expired");
        transfers[_id].registrarApproved = true;
        emit TransferApprovedByRegistrar(_id);
    }

    function rejectTransferByRegistrar(uint256 _id)
        public onlyRegistrar propertyExists(_id)
    {
        require(transfers[_id].active, "No pending transfer");
        _clearTransfer(_id);
        emit TransferRejectedByRegistrar(_id);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — BUYER ACCEPT
    // ─────────────────────────────────────────────
    function acceptTransfer(uint256 _id)
        public nonReentrant propertyExists(_id)
    {
        TransferRecord memory t = transfers[_id];
        require(t.active,                        "No active transfer");
        require(msg.sender == t.buyer,            "Not authorized buyer");
        require(t.registrarApproved,              "Registrar approval pending");
        require(block.timestamp <= t.expiry,      "Transfer expired");

        address oldOwner = core[_id].owner;
        core[_id].owner  = msg.sender;
        ownershipHistory[_id].push(msg.sender);
        uint256 saleValue = t.agreedSaleValueINR;
        _clearTransfer(_id);

        emit OwnershipTransferred(_id, oldOwner, msg.sender, saleValue);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — SELLER CANCEL
    // ─────────────────────────────────────────────
    function cancelTransfer(uint256 _id) public propertyExists(_id) {
        require(core[_id].owner == msg.sender, "Not owner");
        require(transfers[_id].active,          "No pending transfer");
        _clearTransfer(_id);
        emit TransferCancelled(_id, msg.sender);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — PUBLIC EXPIRY CLEANUP
    // ─────────────────────────────────────────────
    function expireTransfer(uint256 _id) public propertyExists(_id) {
        require(transfers[_id].active,                    "No pending transfer");
        require(block.timestamp > transfers[_id].expiry,  "Not yet expired");
        _clearTransfer(_id);
        emit TransferExpired(_id);
    }

    function _clearTransfer(uint256 _id) internal {
        delete transfers[_id];
    }

    // ─────────────────────────────────────────────
    //  DISPUTE
    // ─────────────────────────────────────────────

    /// @notice Any wallet can raise a dispute against a verified property.
    ///         Atomically cancels any pending transfer.
    function raiseDispute(uint256 _id) public propertyExists(_id) {
        require(
            core[_id].status == Status.Verified || core[_id].status == Status.UnderReview,
            "Can only dispute verified properties"
        );
        core[_id].status     = Status.Disputed;
        disputeRaisedBy[_id] = msg.sender;

        // Cancel any live transfer atomically
        if (transfers[_id].active) {
            _clearTransfer(_id);
            emit TransferCancelled(_id, address(0));
        }

        emit Disputed(_id, msg.sender);
    }

    /// @notice PartialFix transitions to UnderReview — not a dead-end.
    function resolveDispute(
        uint256       _id,
        DisputeResult _result,
        string memory _notes
    ) public onlyDisputeOfficer propertyExists(_id) {
        require(
            core[_id].status == Status.Disputed || core[_id].status == Status.UnderReview,
            "Not under dispute or review"
        );
        require(_result != DisputeResult.None, "Invalid result");
        require(bytes(_notes).length > 0,       "Notes required");

        meta[_id].disputeNotes  = _notes;
        core[_id].disputeResult = _result;

        if (_result == DisputeResult.Approved) {
            core[_id].status = Status.Verified;
        } else if (_result == DisputeResult.Rejected) {
            core[_id].status       = Status.Rejected;
            core[_id].isRegistered = false;
            meta[_id].rejectionReason = _notes;
        } else if (_result == DisputeResult.PartialFix) {
            core[_id].status = Status.UnderReview;
            emit DisputeReferred(_id, _notes);
        }

        emit DisputeResolved(_id, _result);
    }

    // ─────────────────────────────────────────────
    //  VIEW FUNCTIONS — split to avoid stack-too-deep
    // ─────────────────────────────────────────────

    function getPropertyCore1(uint256 _id) public view returns (
        uint256 propertyId,
        address owner,
        uint256 areaSqFt,
        uint256 declaredValueINR,
        Status  status,
        bool    isRegistered,
        bool    surveyorApproved
    ) {
        PropertyCore storage c = core[_id];
        return (c.propertyId, c.owner, c.areaSqFt, c.declaredValueINR,
                c.status, c.isRegistered, c.surveyorApproved);
    }

    function getPropertyCore2(uint256 _id) public view returns (
        bool    registrarApproved,
        DisputeResult disputeResult,
        uint256 parentPropertyId,
        uint256 resubmittedFrom
    ) {
        PropertyCore storage c = core[_id];
        return (c.registrarApproved, c.disputeResult,
                c.parentPropertyId, c.resubmittedFrom);
    }

    function getPropertyMeta(uint256 _id) public view returns (
        string memory location,
        string memory unitIdentifier,
        string memory ipfsHash,
        string memory rejectionReason,
        string memory disputeNotes,
        int256  latitude,
        int256  longitude
    ) {
        PropertyMeta storage m = meta[_id];
        return (m.location, m.unitIdentifier, m.ipfsHash,
                m.rejectionReason, m.disputeNotes, m.latitude, m.longitude);
    }

    /// @notice Returns full transfer record for a property.
    function getTransfer(uint256 _id) public view returns (
        address buyer,
        uint256 agreedSaleValueINR,
        uint256 expiry,
        bool    registrarApproved,
        bool    active
    ) {
        TransferRecord storage t = transfers[_id];
        return (t.buyer, t.agreedSaleValueINR, t.expiry, t.registrarApproved, t.active);
    }

    function getOwnershipHistory(uint256 _id) public view returns (address[] memory) {
        return ownershipHistory[_id];
    }

    function getDisputeRaisedBy(uint256 _id) public view returns (address) {
        return disputeRaisedBy[_id];
    }

    function getPendingRoleProposal() public view returns (
        address proposedRegistrar,
        address proposedSurveyor,
        address proposedDisputeOfficer,
        uint256 proposedAt,
        uint256 executeAfter,
        bool    exists
    ) {
        RoleProposal storage p = pendingRoleProposal;
        return (p.proposedRegistrar, p.proposedSurveyor, p.proposedDisputeOfficer,
                p.proposedAt, p.proposedAt + ROLE_TIMELOCK, p.exists);
    }
}
