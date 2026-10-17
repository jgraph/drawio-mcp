## Design for the chat view (read this first too)

When the diagram is shown inline in the chat, it gets about 800 px of width and at most 800 px of height, and it is scaled down until the whole diagram fits. A long or wide diagram shrinks, and its text shrinks with it. Design for that frame:

- **Size:** aim for at most about 12 nodes in a flowchart, and 6 participants and 15 messages in a sequence diagram. Keep every step the user asked for; leave only explanations to your text answer, or draw two diagrams.
- **Complete content:** every participant, step and message the request names, plus the obvious companions (error and alternative paths, the responses).
- **Short labels:** 2–5 words per node, message or edge label, plus the details the request is about: for a protocol, the key parameters and responses (`redirect with code + state`, `POST /token (code, verifier)`), not every header or URL. Put a longer explanation in a `Note over` or your text answer.
- **Title:** start with a `title:` in the frontmatter (see the title block below).
- **Color by role** in flowcharts with `classDef`, the same color for the same kind of node, from draw.io's palette (fill/stroke): blue `#dae8fc`/`#6c8ebf` for main steps, green `#d5e8d4`/`#82b366` for success and outputs, yellow `#fff2cc`/`#d6b656` for decisions, orange `#ffe6cc`/`#d79b00` for external systems and waiting, red `#f8cecc`/`#b85450` for errors and cancellation, purple `#e1d5e7`/`#9673a6` for special steps.
