// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ══════════════════════════════════════════════════════════════
//  ClearTitle — Blockchain Land Registry
//  Version 2.0  |  All phases applied
//
//  Phase 1 fixes:
//    [1] Dispute can be raised by ANY wallet (not just owner)
//    [2] ReentrancyGuard on acceptTransfer
//    [3] PartialFix → UnderReview status (not a dead-end)
//    [4] Role-change timelock (48 h propose → confirm)
//    [5] raiseDispute atomically cancels pending transfer
//
//  Phase 2 fixes:
//    [6]  cancelTransfer — seller can cancel before acceptance
//    [7]  Transfer expiry timestamp (30-day deadline)
//    [8]  Rejection reasons stored on-chain
//    [9]  parentPropertyId + unitIdentifier (flats/multi-unit)
//    [10] resubmittedFrom — links resubmission to old rejected ID
//
//  Phase 4 fixes (contract-side):
//    [16] Approver address + timestamp in every approval event
//    [17] declaredValueINR field
//    [18] Commit-reveal for transfer initiation
// ══════════════════════════════════════════════════════════════

contract LandRegistry {

    // ─────────────────────────────────────────────
    //  REENTRANCY GUARD  [Fix #2]
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

    // [Fix #4] — Role-change timelock
    uint256 public constant ROLE_TIMELOCK = 48 hours;

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
        UnderReview   // 4  [Fix #3] — replaces PartialFix dead-end
    }

    enum DisputeResult {
        None,        // 0
        Approved,    // 1
        Rejected,    // 2
        PartialFix   // 3 — now transitions to UnderReview, not a dead-end
    }

    // ─────────────────────────────────────────────
    //  STRUCTS
    // ─────────────────────────────────────────────
    struct PropertyCore {
        uint256 propertyId;
        address owner;
        uint256 areaSqFt;
        uint256 declaredValueINR;        // [Fix #17]
        Status  status;
        bool    isRegistered;
        bool    surveyorApproved;
        bool    registrarApproved;
        bool    transferPendingRegistrar;
        bool    registrarApprovedTransfer;
        DisputeResult disputeResult;
        // [Fix #9] Multi-unit support
        uint256 parentPropertyId;        // 0 = standalone land parcel
        // [Fix #10] Resubmission link
        uint256 resubmittedFrom;         // 0 = fresh registration
    }

    struct PropertyMeta {
        string  location;
        string  unitIdentifier;          // [Fix #9] e.g. "Flat 4B, Floor 2"
        string  ipfsHash;
        string  rejectionReason;         // [Fix #8]
        string  disputeNotes;
        int256  latitude;
        int256  longitude;
    }

    // [Fix #7] Transfer expiry
    mapping(uint256 => uint256) public transferExpiry;
    uint256 public constant TRANSFER_VALIDITY = 30 days;

    // [Fix #18] Commit-reveal for transfer
    mapping(uint256 => bytes32) public transferCommit;
    mapping(uint256 => uint256) public commitBlock;

    uint256 public propertyCount;

    mapping(uint256 => PropertyCore) public core;
    mapping(uint256 => PropertyMeta) public meta;
    mapping(uint256 => address[])    public ownershipHistory;
    mapping(uint256 => address)      public pendingBuyer;

    // [Fix #1] Track who raised each dispute
    mapping(uint256 => address)      public disputeRaisedBy;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────
    event PropertyRegistered(uint256 id, address owner, uint256 resubmittedFrom);
    event SurveyorApproved(uint256 id, address surveyorAddr, uint256 timestamp);   // [Fix #16]
    event SurveyorRejected(uint256 id, address surveyorAddr, string reason);       // [Fix #8, #16]
    event RegistrarApproved(uint256 id, address registrarAddr, uint256 timestamp); // [Fix #16]
    event RegistrarRejected(uint256 id, address registrarAddr, string reason);     // [Fix #8, #16]
    event Disputed(uint256 id, address raisedBy);                                  // [Fix #1]
    event DisputeResolved(uint256 id, DisputeResult result);
    event DisputeReferred(uint256 id, string notes);                               // [Fix #3]
    event TransferCommitted(uint256 id, bytes32 commitHash);                       // [Fix #18]
    event TransferInitiated(uint256 id, address buyer, uint256 expiry);            // [Fix #7]
    event TransferCancelled(uint256 id, address cancelledBy);                      // [Fix #6]
    event TransferExpired(uint256 id);                                             // [Fix #7]
    event TransferApprovedByRegistrar(uint256 id);
    event TransferRejectedByRegistrar(uint256 id);
    event OwnershipTransferred(uint256 id, address from, address to);
    event RoleChangeProposed(address registrar, address surveyor, address disputeOfficer, uint256 executeAfter); // [Fix #4]
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
    //  ROLES — TIMELOCK PATTERN  [Fix #4]
    // ─────────────────────────────────────────────

    /// @notice Admin proposes new roles. Must be confirmed after ROLE_TIMELOCK.
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

    /// @notice Confirm and apply proposed roles after timelock expires.
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

    /// @notice Cancel a pending role proposal before it is confirmed.
    function cancelRoleProposal() public onlyAdmin {
        require(pendingRoleProposal.exists, "No pending proposal");
        delete pendingRoleProposal;
        emit RoleProposalCancelled();
    }

    // ─────────────────────────────────────────────
    //  REGISTER
    // ─────────────────────────────────────────────

    /// @notice Register a new property.
    /// @param _parentPropertyId  Pass 0 for a land parcel. Pass parent ID for a flat/unit.
    /// @param _unitIdentifier    Empty string for land. "Flat 4B, Floor 2" for units.
    /// @param _resubmittedFrom   Pass 0 for fresh registration. Pass old rejected ID to link.
    /// @param _declaredValueINR  Declared market value in INR (for stamp duty cross-check).
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

        // [Fix #10] Validate resubmission link
        if (_resubmittedFrom != 0) {
            require(core[_resubmittedFrom].propertyId != 0,              "Linked ID does not exist");
            require(core[_resubmittedFrom].owner == msg.sender,           "Not owner of linked property");
            require(core[_resubmittedFrom].status == Status.Rejected,     "Linked property not rejected");
        }

        // [Fix #9] Validate parent property
        if (_parentPropertyId != 0) {
            require(core[_parentPropertyId].propertyId != 0,             "Parent property does not exist");
            require(core[_parentPropertyId].status == Status.Verified,   "Parent must be verified");
            require(bytes(_unitIdentifier).length > 0,                   "Unit identifier required for sub-units");
        }

        propertyCount++;
        uint256 id = propertyCount;

        core[id].propertyId        = id;
        core[id].owner             = msg.sender;
        core[id].areaSqFt          = _areaSqFt;
        core[id].declaredValueINR  = _declaredValueINR;
        core[id].status            = Status.Pending;
        core[id].disputeResult     = DisputeResult.None;
        core[id].parentPropertyId  = _parentPropertyId;
        core[id].resubmittedFrom   = _resubmittedFrom;

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
        emit SurveyorApproved(_id, msg.sender, block.timestamp); // [Fix #16]
    }

    /// @param _reason  Human-readable reason stored permanently on-chain. [Fix #8]
    function rejectBySurveyor(uint256 _id, string memory _reason)
        public onlySurveyor propertyExists(_id)
    {
        require(core[_id].status == Status.Pending, "Not pending");
        require(bytes(_reason).length > 0,           "Reason required");
        core[_id].status           = Status.Rejected;
        meta[_id].rejectionReason  = _reason;
        emit SurveyorRejected(_id, msg.sender, _reason); // [Fix #8, #16]
    }

    // ─────────────────────────────────────────────
    //  REGISTRAR — REGISTRATION
    // ─────────────────────────────────────────────

    function approveByRegistrar(uint256 _id)
        public onlyRegistrar propertyExists(_id)
    {
        require(core[_id].status == Status.Pending,  "Not pending");
        require(core[_id].surveyorApproved,           "Surveyor must approve first");
        core[_id].registrarApproved = true;
        core[_id].isRegistered      = true;
        core[_id].status            = Status.Verified;
        emit RegistrarApproved(_id, msg.sender, block.timestamp); // [Fix #16]
    }

    /// @param _reason  Human-readable reason stored permanently on-chain. [Fix #8]
    function rejectByRegistrar(uint256 _id, string memory _reason)
        public onlyRegistrar propertyExists(_id)
    {
        require(core[_id].status == Status.Pending, "Not pending");
        require(bytes(_reason).length > 0,           "Reason required");
        core[_id].status          = Status.Rejected;
        meta[_id].rejectionReason = _reason;
        emit RegistrarRejected(_id, msg.sender, _reason); // [Fix #8, #16]
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — COMMIT PHASE  [Fix #18]
    // ─────────────────────────────────────────────

    /// @notice Step 1 of commit-reveal. Seller commits keccak256(propertyId, buyerAddr, nonce).
    ///         The buyer address is hidden until reveal, preventing mempool front-running.
    function commitTransfer(uint256 _id, bytes32 _commitHash)
        public propertyExists(_id)
    {
        require(core[_id].owner  == msg.sender,      "Not owner");
        require(core[_id].status == Status.Verified,  "Not verified");
        require(pendingBuyer[_id] == address(0),      "Transfer already active");
        transferCommit[_id] = _commitHash;
        commitBlock[_id]    = block.number;
        emit TransferCommitted(_id, _commitHash);
    }

    /// @notice Step 2 of commit-reveal. Reveal buyer address and nonce after ≥1 block.
    function initiateTransfer(uint256 _id, address _buyer, bytes32 _nonce)
        public propertyExists(_id)
    {
        require(core[_id].owner  == msg.sender,       "Not owner");
        require(core[_id].status == Status.Verified,  "Not verified");
        require(_buyer != address(0),                  "Invalid buyer");
        require(_buyer != msg.sender,                  "Cannot transfer to self");
        require(pendingBuyer[_id] == address(0),       "Transfer already pending");
        require(block.number > commitBlock[_id],       "Must wait 1 block after commit");

        // Verify the revealed values match the commit hash
        bytes32 expected = keccak256(abi.encodePacked(_id, _buyer, _nonce));
        require(transferCommit[_id] == expected,       "Commit mismatch");

        // Clear commit
        delete transferCommit[_id];
        delete commitBlock[_id];

        uint256 expiry = block.timestamp + TRANSFER_VALIDITY;
        pendingBuyer[_id]                   = _buyer;
        core[_id].transferPendingRegistrar  = true;
        core[_id].registrarApprovedTransfer = false;
        transferExpiry[_id]                 = expiry;

        emit TransferInitiated(_id, _buyer, expiry);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — REGISTRAR APPROVAL
    // ─────────────────────────────────────────────

    function approveTransferByRegistrar(uint256 _id)
        public onlyRegistrar propertyExists(_id)
    {
        require(core[_id].transferPendingRegistrar,   "No pending transfer");
        require(!core[_id].registrarApprovedTransfer, "Already approved");
        require(block.timestamp <= transferExpiry[_id], "Transfer expired"); // [Fix #7]
        core[_id].registrarApprovedTransfer = true;
        emit TransferApprovedByRegistrar(_id);
    }

    function rejectTransferByRegistrar(uint256 _id)
        public onlyRegistrar propertyExists(_id)
    {
        require(core[_id].transferPendingRegistrar, "No pending transfer");
        _clearTransferState(_id);
        emit TransferRejectedByRegistrar(_id);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — BUYER ACCEPT
    // ─────────────────────────────────────────────

    function acceptTransfer(uint256 _id)
        public nonReentrant propertyExists(_id) // [Fix #2]
    {
        require(msg.sender == pendingBuyer[_id],             "Not authorized buyer");
        require(core[_id].registrarApprovedTransfer,          "Registrar approval pending");
        require(block.timestamp <= transferExpiry[_id],       "Transfer expired"); // [Fix #7]

        address oldOwner    = core[_id].owner;
        core[_id].owner     = msg.sender;
        ownershipHistory[_id].push(msg.sender);
        _clearTransferState(_id);

        emit OwnershipTransferred(_id, oldOwner, msg.sender);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — SELLER CANCEL  [Fix #6]
    // ─────────────────────────────────────────────

    /// @notice Seller can cancel a pending transfer at any time before buyer accepts.
    function cancelTransfer(uint256 _id) public propertyExists(_id) {
        require(core[_id].owner == msg.sender,          "Not owner");
        require(core[_id].transferPendingRegistrar,     "No pending transfer");
        _clearTransferState(_id);
        emit TransferCancelled(_id, msg.sender);
    }

    // ─────────────────────────────────────────────
    //  TRANSFER — PUBLIC EXPIRY  [Fix #7]
    // ─────────────────────────────────────────────

    /// @notice Anyone can call this to clean up a transfer that has passed its deadline.
    function expireTransfer(uint256 _id) public propertyExists(_id) {
        require(core[_id].transferPendingRegistrar,         "No pending transfer");
        require(block.timestamp > transferExpiry[_id],      "Not yet expired");
        _clearTransferState(_id);
        emit TransferExpired(_id);
    }

    /// @dev Internal helper — clears all transfer-related state in one place.
    function _clearTransferState(uint256 _id) internal {
        pendingBuyer[_id]                        = address(0);
        core[_id].transferPendingRegistrar       = false;
        core[_id].registrarApprovedTransfer      = false;
        transferExpiry[_id]                      = 0;
    }

    // ─────────────────────────────────────────────
    //  DISPUTE  [Fix #1, #3, #5]
    // ─────────────────────────────────────────────

    /// @notice Any wallet can raise a dispute against a verified property.
    ///         [Fix #1] — Removed owner-only restriction.
    ///         [Fix #5] — Atomically cancels any pending transfer.
    function raiseDispute(uint256 _id) public propertyExists(_id) {
        require(
            core[_id].status == Status.Verified || core[_id].status == Status.UnderReview,
            "Can only dispute verified properties"
        );

        core[_id].status       = Status.Disputed;
        disputeRaisedBy[_id]   = msg.sender;

        // [Fix #5] Cancel any live transfer atomically
        if (core[_id].transferPendingRegistrar) {
            _clearTransferState(_id);
            emit TransferCancelled(_id, address(0)); // address(0) = system-cancelled
        }

        emit Disputed(_id, msg.sender);
    }

    /// @notice Dispute officer resolves a dispute.
    ///         [Fix #3] PartialFix now transitions to UnderReview (not a dead-end).
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
            // [Fix #3] Transition to UnderReview — officer can revisit
            core[_id].status = Status.UnderReview;
            emit DisputeReferred(_id, _notes);
        }

        emit DisputeResolved(_id, _result);
    }

    // ─────────────────────────────────────────────
    //  VIEW FUNCTIONS
    // ─────────────────────────────────────────────

    // Split into two functions — 13 return values in one function causes
    // "stack too deep" in the EVM. Seven values max per getter is safe.

    /// @notice Returns ownership + status fields for a property.
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
        return (
            c.propertyId,
            c.owner,
            c.areaSqFt,
            c.declaredValueINR,
            c.status,
            c.isRegistered,
            c.surveyorApproved
        );
    }

    /// @notice Returns approval + transfer + dispute + hierarchy fields.
    function getPropertyCore2(uint256 _id) public view returns (
        bool    registrarApproved,
        bool    transferPendingRegistrar,
        bool    registrarApprovedTransfer,
        DisputeResult disputeResult,
        uint256 parentPropertyId,
        uint256 resubmittedFrom
    ) {
        PropertyCore storage c = core[_id];
        return (
            c.registrarApproved,
            c.transferPendingRegistrar,
            c.registrarApprovedTransfer,
            c.disputeResult,
            c.parentPropertyId,
            c.resubmittedFrom
        );
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
        return (
            m.location,
            m.unitIdentifier,
            m.ipfsHash,
            m.rejectionReason,
            m.disputeNotes,
            m.latitude,
            m.longitude
        );
    }

    function getOwnershipHistory(uint256 _id) public view returns (address[] memory) {
        return ownershipHistory[_id];
    }

    function getPendingBuyer(uint256 _id) public view returns (address) {
        return pendingBuyer[_id];
    }

    function getTransferExpiry(uint256 _id) public view returns (uint256) {
        return transferExpiry[_id];
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
        return (
            p.proposedRegistrar,
            p.proposedSurveyor,
            p.proposedDisputeOfficer,
            p.proposedAt,
            p.proposedAt + ROLE_TIMELOCK,
            p.exists
        );
    }

    function getDisputeRaisedBy(uint256 _id) public view returns (address) {
        return disputeRaisedBy[_id];
    }
}
