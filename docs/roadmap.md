# Roadmap

Planning lives on GitHub: [milestones](https://github.com/SchwammDev/nestor/milestones) hold the stages, issues hold the user stories (requirements + broad direction). Voice-frontend milestones (Voice Migration, Barge-in) live in [pi-card](https://github.com/SchwammDev/pi-card/milestones). Rolling main release — no versions.

The vision is a growing personal-agent platform: an always-on **agent core** (Hetzner, co-located with Nextcloud) with thin channel frontends — pi-card is the voice frontend, Signal the text frontend. Proactive capabilities (scheduling, reminders, email triage) live in the core.

Delivery sequence:

1. **Core Split** — substrate spike (pi-agent-core), core daemon on Hetzner, Signal as first client
2. **Tool Use Foundation** — first core-side tools (time/date, timers) and the announcement push path
3. **Nextcloud: Read Access** — "what do I have to do today"; tools live in the core
4. **Reminders** — persistent, survive restart
5. **Nextcloud: Write & Planning** — dictate notes, calendar writes, plan my day/week
6. **Voice Migration** (pi-card) — pi-card becomes a thin core client: audio pipeline + WebSocket, announcement playback
7. **Proactive Autonomy** — commitment capture, self-scheduled reminders, email triage
8. **Barge-in** (pi-card) — interrupt mid-reply; announcements cut in
9. **Conversation Memory** — cross-session, opt-in, shared across channels

Sequencing rationale: the Core Split lands first — building a voice-local loop only to replace it at the split would be throwaway work, and the split's spike de-risks the substrate before anything depends on it. Signal is the first client, not voice: it's the cheapest channel to build and lets core, tools, and proactivity be tested without touching the audio layer, while the voice box keeps working in-process until its migration. Tool Use Foundation then exercises the wire path end to end; Nextcloud tools follow because tools live in the core; read and reminders deliver value before write/planning; voice migrates once the core is proven; barge-in is conversation polish, value comes first; memory pays off once tools generate state worth remembering — and multi-channel makes shared context load-bearing.

Substrate decision (recorded 2026-05): **pi-agent-core** (TypeScript) for the agent core, validated by a spike before the split. An earlier Python-native plan (pydantic-ai) was the right call for a standalone voice appliance; for the platform, the deciding factors are hands-on experience from liubai-mind and personally known, trusted maintainers, with first-class extensibility (including agent self-extension) as a supporting factor. The spike passed all hard gates (2026-08-16, SchwammDev/pi-card#4); the pydantic-ai fallback is retired. The voice frontend's audio pipeline stays Python regardless.

Privacy posture: audio stays on-device; transcripts transit to the Hetzner core (same trust domain as Nextcloud). Core unreachable → voice frontend degrades with the existing spoken-error pattern.

## Not pursuing

- Third-party cloud STT — ruled out by privacy posture; Aqueduct covers the speed case.
- Multi-device sync — channels converge on the core instead.
