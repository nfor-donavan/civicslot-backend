# CivicSlot API

Node.js + Express + Mongoose. Serves the mobile app and the administration portal.

```bash
cp .env.example .env && npm install
npm run dev      # development
npm run seed     # idempotent demo data (see docs/DEPLOYMENT.md before using on a real database)
npm test         # needs a DISPOSABLE local MongoDB (databases civicslot_test_* are dropped)
npm run docs     # regenerate docs/generated/*.md from the code
```
Every route and its access level is declared in `scripts/route-manifest.js`; `tests/rbac.test.js` fails if the manifest and the code disagree.
