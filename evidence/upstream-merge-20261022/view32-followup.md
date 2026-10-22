# View law follow-up for upstream c2afb1af

The ordinary merge retains parent `63286b49217b6c4e0f6be084779fd8e1f2296a1b` and upstream `c2afb1af5e54dfe4b5520d36ade14123d6032bc1`. The tested index tree was `1c00afb4d1b828abcfd2a289d2654e8f966131bf`; subsequent edits only record this receipt.

Unlisted live intervals outside the protected prefix are omitted. Explicit null keeps an interval, and a summary replaces it. Drop boundaries are captured from the same live partition as replacements; old drops do not consume later input or revive retired anchors. Direct plan calls retain strict null validation, immutable answers, and own-field/accessor checks. The existing delivery, whole-run budget, VM and process source files are unchanged.

Local evidence, using Node 22.13.0 and Bun 1.3.14:

- `npm run build`: exit 0.
- `npm test`: 1025 tests, 1018 pass, 0 fail, 7 skip, 0 TODO; 74863ms.
- Bun compression 001/002/003 and failure-budget 001/002: 29 pass, 0 fail.
- A real package was installed offline in a separate temporary consumer. Both Node22 and Bun verified prefix protection, omitted intervals, explicit null, empty mapping, direct-plan undefined rejection, the public original budget API and 60 whole-run budget resets. Both exited 0.
- Package SHA256: `d3e326e046e0bc75405dfc6e89454d5256a761ad5ace700c2e4c4a25d553257c`.

Raw logs and package remain outside the repository at `/private/tmp/m22-library-c2-*` and `/private/tmp/m22-library-view32-package/`. The two previously recorded Bun VM post-await hard-deadline failures remain separate. This receipt does not close them or prove the host integration; the main repository must test its exact gitlink and actual consumers.
