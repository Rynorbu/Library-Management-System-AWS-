# Report figures

| Figure | PNG (2×, for the report) | Source |
|---|---|---|
| 1. Architecture | `docs/architecture.png`, exported from the lab site (import `docs/architecture/library-architecture.json`, run **Simulate** "Reserve a book", export) | `docs/architecture/library-architecture.json` |
| 2. Reservation sequence | [`docs/fig2-reservation-sequence.png`](../fig2-reservation-sequence.png) | [`fig2-reservation-sequence.mmd`](fig2-reservation-sequence.mmd) |
| 3. CI/CD pipeline | [`docs/fig3-cicd.png`](../fig3-cicd.png) | [`fig3-cicd.mmd`](fig3-cicd.mmd) |
| 4. ER diagram | [`docs/fig4-er.png`](../fig4-er.png) | [`fig4-er.mmd`](fig4-er.mmd) |

**Suggested captions**
- *Figure 2: Reserving a book. The row lock on the book serialises concurrent requests. The reservation and its email are committed in one transaction (transactional outbox). The email is then published to SQS, sent by the notifier Lambda through SES, and its status is reported back to the app.*
- *Figure 3: CI/CD with GitHub Actions. Every pull request is linted, tested against PostgreSQL 16 and built. A deploy needs a reviewer's approval, then runs a rolling update on Elastic Beanstalk that rolls back automatically if health checks fail.*
- *Figure 4: Database schema (PostgreSQL 16). `notifications` is both the email outbox and the email log.*

## Re-render after a change
The `.mmd` files are [Mermaid](https://mermaid.js.org). GitHub shows them as diagrams, and you can paste them into mermaid.live or draw.io (*Arrange → Insert → Mermaid*). To regenerate the PNGs:

```bash
cd docs/diagrams
for f in fig2-reservation-sequence fig3-cicd fig4-er; do
  npx -y @mermaid-js/mermaid-cli@12.2.0 -c mermaid.config.json -i $f.mmd -o ../$f.png -s 2 -b white
done
```
