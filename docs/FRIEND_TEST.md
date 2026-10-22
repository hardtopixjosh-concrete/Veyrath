# Milestone 2 — friend test over Tailscale

Goal: two people on **different internet connections** play together for 30+ minutes, and we record
real numbers (ping, jitter, gaps, reconnects, server load). A local test can't stand in for this.

**Roles:** the **host** runs the server and plays on the same PC (needs this repo). The **friend**
only needs the zip.

## One-time setup

### Both of you

1. Install Tailscale from <https://tailscale.com/download> and sign in (each with your own account
   is fine).

### Host

2. Let your friend reach your PC. Easiest: in the Tailscale admin console → **Machines** → your PC →
   **Share…** → send the invite link to your friend. (Alternatively invite them to your tailnet.)
3. Find your Tailscale address:

   ```bash
   tailscale ip -4
   ```

   It looks like `100.x.y.z`.

4. Build the friend zip with that address baked in:

   ```bash
   npm run package:friend -- --server=ws://100.x.y.z:7777
   ```

   Output: `apps/desktop/release/Veyrath-friend.zip`. Send it to your friend any way you like.

5. **Windows Firewall.** The first time the server starts, Windows may ask whether Node.js may
   accept connections. Tick **Private networks**, then **Allow**. If your friend still can't connect,
   open PowerShell **as Administrator** and add a rule that only allows Tailscale addresses on the
   game port:

   ```powershell
   New-NetFirewallRule -DisplayName "Veyrath server (Tailscale only)" -Direction Inbound -Protocol TCP -LocalPort 7777 -RemoteAddress 100.64.0.0/10 -Action Allow
   ```

### Friend

6. Accept the share invite in Tailscale.
7. Unzip `Veyrath-friend.zip` and run `Veyrath\Veyrath.exe`. SmartScreen may warn about an
   unrecognized app (the test build is unsigned): **More info → Run anyway**.

## Each session

**Host:**

```bash
npm run host -- --client
```

This starts the server on your Tailscale address, opens your game window, and writes a metrics file
to `logs/metrics-<time>.jsonl` (path printed at start). Click **Create room** and tell your friend
the 5-letter code.

**Friend:** the Server box is already filled in. Type the code and click **Join room**.

Both: press **F3** for the debug overlay (ping, jitter, snapshot rate, FPS).

Stop with **Ctrl+C** in the host terminal; it prints the metrics path and the summary command:

```bash
npm run metrics:report -- "logs/metrics-<time>.jsonl"
```

Optional sanity check before playing, from the friend's PC: `tailscale ping 100.x.y.z`. Note whether
it says **via DERP** (relayed — adds latency) or a direct address.

## Test checklist

Fill in **Passed / Failed / Not run** and notes. Don't mark anything passed that you didn't do.

| #   | Check                                                                                                | Result  | Notes |
| --- | ---------------------------------------------------------------------------------------------------- | ------- | ----- |
| F1  | Friend's zip starts, lobby shows the host's server, Join works                                       | Not run |       |
| F2  | Both see each other move; both hit the enemy; HP bar matches on both screens                         | Not run |       |
| F3  | Feel: own movement responsive; other player and enemy move smoothly (write down F3 ping/jitter)      | Not run |       |
| F4  | 30 minutes in one room without an unexpected disconnect or long freeze                               | Not run |       |
| F5  | Friend drops for ~5 s (Wi-Fi off, or `tailscale down` then `tailscale up`) → back as the same player | Not run |       |
| F6  | Friend drops for > 20 s → returns to lobby with a message; can join again as a new player            | Not run |       |
| F7  | Each player minimizes the game for 30 s; the other keeps playing normally                            | Not run |       |
| F8  | Leave and re-join the room 3 times                                                                   | Not run |       |
| F9  | Host stops the server (Ctrl+C) mid-game → friend lands in the lobby with a clear message, no crash   | Not run |       |
| F10 | Tailscale path noted (`tailscale ping`: direct or DERP relay)                                        | Not run |       |

## Afterwards — send back to Claude

- The `npm run metrics:report` output (and/or the `.jsonl` file),
- the filled checklist,
- anything that felt wrong (rubber-banding, stutter, delayed hits) and roughly when.

Those numbers decide whether to tune anything (interpolation delay, snapshot rate, catch-up
limits) before moving on. Nothing gets tuned on a guess.
