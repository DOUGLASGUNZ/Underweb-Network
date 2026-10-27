// UnderWeb Court: courtroom bench (UdonSharp, VRChat SDK 3 Worlds).
// FICTIONAL ROLEPLAY ONLY. NOT COMPILED OR TESTED IN UNITY YET.
//
// The room never talks to the website. A judge exports a result as text. Linked staff paste it at /court/judge.
// Claim codes are NOT made here; the website issues them after a result is submitted.
//
// Gates: staff can always operate the room. Everyone else needs the bench unlocked for this session
// AND their role opened by staff. Parties answer only if they are the defendant (or staff).

using UdonSharp;
using UnityEngine;
using TMPro;
using VRC.SDKBase;

public class CourtBench : UdonSharpBehaviour
{
    // Button actions. CourtButton.action must use these numbers.
    public const int ACT_UNLOCK = 0;
    public const int ACT_LOCK = 1;
    public const int ACT_TOGGLE_CLERK = 2;
    public const int ACT_TOGGLE_PARTIES = 3;
    public const int ACT_TOGGLE_JURY = 4;
    public const int ACT_TOGGLE_JUDGE = 5;
    public const int ACT_NEXT_PLAINTIFF = 6;
    public const int ACT_NEXT_DEFENDANT = 7;
    public const int ACT_OPEN_CASE = 8;
    public const int ACT_SEND_PROMPT = 9;
    public const int ACT_PROMPT_ALLOW = 10;
    public const int ACT_PROMPT_PRIVATE = 11;
    public const int ACT_DECLINE = 12;
    public const int ACT_CALL_JURY = 13;
    public const int ACT_JURY_GUILTY = 14;
    public const int ACT_JURY_NOT_GUILTY = 15;
    public const int ACT_VERDICT_GUILTY = 16;
    public const int ACT_VERDICT_NOT_GUILTY = 17;
    public const int ACT_EXPORT = 18;
    public const int ACT_CLOSE_CASE = 19;

    // Role bits (openRoles)
    public const int ROLE_CLERK = 1;
    public const int ROLE_PARTIES = 2;
    public const int ROLE_JURY = 4;
    public const int ROLE_JUDGE = 8;

    public const int PHASE_NONE = 0;
    public const int PHASE_OPEN = 1;
    public const int PHASE_VOTE = 2;
    public const int PHASE_CLOSED = 3;

    public const int PROMPT_NONE = 0;
    public const int PROMPT_WAITING = 1;
    public const int PROMPT_ALLOWED = 2;
    public const int PROMPT_PRIVATE = 3;

    public const int VERDICT_NONE = 0;
    public const int VERDICT_GUILTY = 1;
    public const int VERDICT_NOT_GUILTY = 2;

    public const int JURY_SEATS = 6;

    [Header("Staff")]
    [Tooltip("Display names allowed to unlock the bench, besides the instance owner. Display names can be copied, so this is a room convenience. The website check is the real one.")]
    public string[] staffDisplayNames = new string[0];

    [Header("Screens and seats")]
    public TextMeshProUGUI statusText;
    public TextMeshProUGUI exportText;
    public GameObject[] jurySeats = new GameObject[JURY_SEATS];

    [Header("Export")]
    public CourtChecksum checksum;
    [Tooltip("Damages from the website filing. Set this in the room before export. The room has no damages input yet.")]
    public int damagesRequested = 0;

    // Synced room state. Each press takes ownership, changes these, then serialises.
    [UdonSynced] public bool unlocked;
    [UdonSynced] public int openRoles;
    [UdonSynced] public int phase;
    [UdonSynced] public int caseNo;
    [UdonSynced] public int plaintiffId = -1;
    [UdonSynced] public int defendantId = -1;
    [UdonSynced] public int promptState;
    [UdonSynced] public int verdict;
    [UdonSynced] public int juryGuilty;
    [UdonSynced] public int juryNotGuilty;

    // Known gap: jury tallies are counts, not one vote per player. A juror can press twice.

    public void Press(int action)
    {
        VRCPlayerApi me = Networking.LocalPlayer;
        if (me == null) return;
        if (!Allowed(action, me))
        {
            Say("Not available to you right now.");
            return;
        }
        Networking.SetOwner(me, gameObject);
        if (!Apply(action, me)) { Refresh(); return; }
        RequestSerialization();
        Refresh();
    }

    public override void OnDeserialization()
    {
        Refresh();
    }

    // ------------------------------------------------------------------ gates

    bool IsStaff(VRCPlayerApi p)
    {
        if (Networking.IsInstanceOwner) return true;
        string name = p.displayName;
        foreach (string s in staffDisplayNames) if (s == name) return true;
        return false;
    }

    bool CanUse(int role, VRCPlayerApi p)
    {
        return IsStaff(p) || (unlocked && (openRoles & role) != 0);
    }

    bool Allowed(int action, VRCPlayerApi p)
    {
        bool staff = IsStaff(p);
        switch (action)
        {
            case ACT_UNLOCK:
            case ACT_LOCK:
            case ACT_TOGGLE_CLERK:
            case ACT_TOGGLE_PARTIES:
            case ACT_TOGGLE_JURY:
            case ACT_TOGGLE_JUDGE:
                return staff;
            case ACT_NEXT_PLAINTIFF:
            case ACT_NEXT_DEFENDANT:
            case ACT_OPEN_CASE:
            case ACT_SEND_PROMPT:
            case ACT_CLOSE_CASE:
                return CanUse(ROLE_CLERK, p);
            case ACT_PROMPT_ALLOW:
            case ACT_PROMPT_PRIVATE:
            case ACT_DECLINE:
                return CanUse(ROLE_PARTIES, p) && (p.playerId == defendantId || staff);
            case ACT_CALL_JURY:
            case ACT_VERDICT_GUILTY:
            case ACT_VERDICT_NOT_GUILTY:
            case ACT_EXPORT:
                return CanUse(ROLE_JUDGE, p);
            case ACT_JURY_GUILTY:
            case ACT_JURY_NOT_GUILTY:
                return CanUse(ROLE_JURY, p);
        }
        return false;
    }

    // ------------------------------------------------------------------ actions

    bool Apply(int action, VRCPlayerApi me)
    {
        switch (action)
        {
            case ACT_UNLOCK:
                unlocked = true;
                Say("Bench unlocked for this session.");
                return true;
            case ACT_LOCK:
                unlocked = false;
                openRoles = 0;
                if (phase == PHASE_OPEN || phase == PHASE_VOTE) phase = PHASE_CLOSED;
                Say("Bench locked. Public roles cleared.");
                return true;
            case ACT_TOGGLE_CLERK: return ToggleRole(ROLE_CLERK, "clerk");
            case ACT_TOGGLE_PARTIES: return ToggleRole(ROLE_PARTIES, "parties");
            case ACT_TOGGLE_JURY: return ToggleRole(ROLE_JURY, "jury");
            case ACT_TOGGLE_JUDGE: return ToggleRole(ROLE_JUDGE, "judge");
            case ACT_NEXT_PLAINTIFF:
                plaintiffId = NextPlayerId(plaintiffId);
                return true;
            case ACT_NEXT_DEFENDANT:
                defendantId = NextPlayerId(defendantId);
                return true;
            case ACT_OPEN_CASE:
                return OpenCase();
            case ACT_SEND_PROMPT:
                if (phase != PHASE_OPEN && phase != PHASE_VOTE) return Refuse("Open a case first.");
                promptState = PROMPT_WAITING;
                Say("Consent prompt sent to the defendant, privately.");
                return true;
            case ACT_PROMPT_ALLOW:
                if (promptState != PROMPT_WAITING) return Refuse("No prompt waiting.");
                promptState = PROMPT_ALLOWED;
                Say("Defendant allowed publishing. A judge still has to approve.");
                return true;
            case ACT_PROMPT_PRIVATE:
                if (promptState != PROMPT_WAITING) return Refuse("No prompt waiting.");
                promptState = PROMPT_PRIVATE;
                Say("Defendant kept the case private.");
                return true;
            case ACT_DECLINE:
                if (phase != PHASE_OPEN && phase != PHASE_VOTE) return Refuse("No open case.");
                phase = PHASE_CLOSED;
                promptState = PROMPT_NONE;
                Say("Defendant declined. The case ends.");
                return true;
            case ACT_CALL_JURY:
                if (phase != PHASE_OPEN) return Refuse("Open a case before calling the jury.");
                phase = PHASE_VOTE;
                Say("Jury vote called.");
                return true;
            case ACT_JURY_GUILTY:
            case ACT_JURY_NOT_GUILTY:
                if (phase != PHASE_VOTE) return Refuse("The jury is not voting.");
                if (juryGuilty + juryNotGuilty >= JURY_SEATS) return Refuse("All jury seats have voted.");
                if (action == ACT_JURY_GUILTY) juryGuilty += 1; else juryNotGuilty += 1;
                return true;
            case ACT_VERDICT_GUILTY:
            case ACT_VERDICT_NOT_GUILTY:
                if (phase != PHASE_VOTE) return Refuse("Call the jury vote first.");
                verdict = action == ACT_VERDICT_GUILTY ? VERDICT_GUILTY : VERDICT_NOT_GUILTY;
                Say("Verdict recorded.");
                return true;
            case ACT_EXPORT:
                if (phase != PHASE_VOTE || verdict == VERDICT_NONE) return Refuse("Record a verdict before exporting.");
                exportText.text = BuildExport();
                Say("Result exported. Linked staff submit it at /court/judge.");
                return false; // export is local text only; nothing to sync
            case ACT_CLOSE_CASE:
                if (phase == PHASE_NONE || phase == PHASE_CLOSED) return Refuse("No open case.");
                phase = PHASE_CLOSED;
                Say("Case closed.");
                return true;
        }
        return false;
    }

    bool ToggleRole(int role, string label)
    {
        if (!unlocked) return Refuse("Unlock the bench first.");
        openRoles = (openRoles & role) != 0 ? (openRoles & ~role) : (openRoles | role);
        Say(label + ((openRoles & role) != 0 ? " opened to the public." : " locked again."));
        return true;
    }

    bool OpenCase()
    {
        if (plaintiffId < 0 || defendantId < 0) return Refuse("Pick both players first.");
        if (plaintiffId == defendantId) return Refuse("The plaintiff and defendant must be different players.");
        if (phase == PHASE_OPEN || phase == PHASE_VOTE) return Refuse("A case is already open.");
        caseNo += 1;
        phase = PHASE_OPEN;
        promptState = PROMPT_NONE;
        verdict = VERDICT_NONE;
        juryGuilty = 0;
        juryNotGuilty = 0;
        Say("Opened case " + caseNo + ".");
        return true;
    }

    bool Refuse(string text)
    {
        Say(text);
        return false;
    }

    int NextPlayerId(int current)
    {
        // Walk ids from the current one, so the picker cycles through everyone in the instance.
        for (int step = 1; step <= 100; step++)
        {
            int id = (current + step) % 100;
            if (id < 0) id += 100;
            VRCPlayerApi p = VRCPlayerApi.GetPlayerById(id);
            if (p != null && p.IsValid()) return id;
        }
        return -1;
    }

    // ------------------------------------------------------------------ export

    // Builds the result the website expects (format_version 1). Keys are written in sorted order,
    // the same order as canonicalJson() in supabase/functions/court/logic.ts.
    string BuildExport()
    {
        double secs = Networking.GetServerTimeInMilliseconds() / 1000.0;
        string isoNow = IsoUtc(secs);
        string localRef = "R" + caseNo + "-" + ((int)secs).ToString();
        string accusation = "ROOM-" + caseNo.ToString();

        string plaintiffLabel = LabelFor(plaintiffId);
        string defendantLabel = LabelFor(defendantId);
        bool defendantConsents = promptState == PROMPT_ALLOWED;
        string verdictWord = verdict == VERDICT_GUILTY ? "guilty" : "not_guilty";

        // Plaintiff publish consent is recorded on the website at filing, not in the room.
        string body =
            "{\"accusation_id\":\"" + Esc(accusation) + "\"" +
            ",\"damages_requested\":" + damagesRequested.ToString() +
            ",\"defendant\":{\"consent_publish\":" + (defendantConsents ? "true" : "false") + ",\"label\":\"" + Esc(defendantLabel) + "\"}" +
            ",\"exported_at\":\"" + isoNow + "\"" +
            ",\"format_version\":1" +
            ",\"jury\":{\"guilty\":" + juryGuilty.ToString() + ",\"not_guilty\":" + juryNotGuilty.ToString() + "}" +
            ",\"local_ref\":\"" + Esc(localRef) + "\"" +
            ",\"notes\":\"\"" +
            ",\"plaintiff\":{\"consent_publish\":false,\"label\":\"" + Esc(plaintiffLabel) + "\"}" +
            ",\"verdict\":\"" + verdictWord + "\"}";

        string sum = checksum != null ? checksum.Sha256Hex(body) : "";
        // Insert the checksum before the final brace. Parsers accept any key order.
        return body.Substring(0, body.Length - 1) + ",\"checksum\":\"" + sum + "\"}";
    }

    string LabelFor(int id)
    {
        VRCPlayerApi p = VRCPlayerApi.GetPlayerById(id);
        if (p == null) return "Unnamed (unverified)";
        return Ascii(p.displayName) + " (unverified)";
    }

    // The checksum is computed over ASCII bytes, so non-ASCII names are replaced here.
    string Ascii(string s)
    {
        if (s == null) return "Unnamed";
        char[] chars = s.ToCharArray();
        for (int i = 0; i < chars.Length; i++)
        {
            if (chars[i] < 32) chars[i] = ' ';
            else if (chars[i] > 126) chars[i] = '?';
            else if (chars[i] == '\\') chars[i] = '/';
        }
        string clean = new string(chars).Trim();
        return clean.Length == 0 ? "Unnamed" : clean;
    }

    string Esc(string s)
    {
        return s.Replace("\"", "\\\"");
    }

    // Converts server time (seconds since 1970 UTC) to ISO 8601 without any .NET date types.
    string IsoUtc(double secs)
    {
        int days = (int)System.Math.Floor(secs / 86400.0);
        int sod = (int)(secs - days * 86400.0);
        int z = days + 719468;
        int era = (z >= 0 ? z : z - 146096) / 146097;
        int doe = z - era * 146097;
        int yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        int y = yoe + era * 400;
        int doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        int mp = (5 * doy + 2) / 153;
        int d = doy - (153 * mp + 2) / 5 + 1;
        int m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y += 1;
        return y.ToString() + "-" + Pad2(m) + "-" + Pad2(d) + "T" + Pad2(sod / 3600) + ":" + Pad2((sod % 3600) / 60) + ":" + Pad2(sod % 60) + "Z";
    }

    string Pad2(int n) { return n < 10 ? "0" + n.ToString() : n.ToString(); }

    // ------------------------------------------------------------------ screens

    string _message = "";

    void Say(string text)
    {
        _message = text;
    }

    void Refresh()
    {
        string bench = unlocked ? "Unlocked this session" : "Locked";
        string phaseWord = phase == PHASE_OPEN ? "Open" : phase == PHASE_VOTE ? "Jury vote" : phase == PHASE_CLOSED ? "Closed" : "No case";
        string roles = "clerk " + OnOff(ROLE_CLERK) + ", parties " + OnOff(ROLE_PARTIES) + ", jury " + OnOff(ROLE_JURY) + ", judge " + OnOff(ROLE_JUDGE);
        for (int i = 0; i < jurySeats.Length; i++)
        {
            if (jurySeats[i] != null) jurySeats[i].SetActive(i < juryGuilty + juryNotGuilty);
        }
        _stateLine = "Bench: " + bench + "  |  Case: " + phaseWord + " " + caseNo + "  |  Roles: " + roles;
        if (statusText != null) statusText.text = _stateLine + "\n" + _message;
    }

    string _stateLine = "";

    string OnOff(int role)
    {
        return (openRoles & role) != 0 ? "open" : "locked";
    }
}
