# MongoDB Security Demo

A web demo of MongoDB users, custom roles, and read access to a view. The source documents live in `secdemo.data`; the generated Alice and Bob users can read `secdemo.secview`, but cannot read the source collection. The app uses the cluster account provided during setup to inspect source data and manage the view, and connects as Alice or Bob when reading the view.

## Prerequisites

- A MongoDB cluster reachable from this machine.
- A MongoDB account with permission to create and update database users and roles, read/write the `secdemo` database, and create/drop views.
- Node.js and npm.
- MongoDB 7.0 or later for the `$$USER_ROLES` row-policy example; the other examples use standard aggregation variables and operators.

## Set up and run

From the project directory, run this single command:

```sh
npm run setup
```

The command installs the Node.js dependencies, then prompts for the cluster connection URI. Input is hidden while you type. Enter a URI for the privileged account described above; include its authentication database in the URI when it is not the default. Setup connects to the cluster and creates or updates the demo roles and users, adds sample data if `secdemo.data` is empty, and creates the initial confidential-only view. It generates unique passwords for Alice and Bob and saves all connection details and generated credentials to the local `config/local.json` file with owner-only permissions. Passwords are never printed. This file is ignored by Git; do not share it.

Start the app:

```sh
npm start
```

Open <http://localhost:3000>.

This is a local demonstration app, not a production service. It has demo endpoints that can change the active demo user and replace the view definition using an administrative cluster account. The server binds to loopback only; do not expose it through a proxy, tunnel, or public network.

Run `npm run setup` again to reapply roles and restore the initial view. Existing generated user passwords are reused from the private local config so a running app does not lose its credentials. Existing documents are preserved; the standard sample documents are added only when `secdemo.data` is empty. Three clearly named age/time policy examples are also upserted each run.

## Demonstrate the access controls

1. The app opens as Alice. The initial view displays confidential documents. Switch between Alice and Bob using the user selector; both can read the view.
2. Choose a pipeline example (for example **Secret**) or enter `pipeline = [{ $match: { classification: 'secret' } }];`, then test and apply it. The view definition and results update.
3. Use the interface to compare the displayed source data with the view results. Alice and Bob's generated cluster accounts can query the view but are denied access to the underlying collection.

## Demonstrate document and field policies: RBAC and ABAC

MongoDB's built-in RBAC grants actions on resources such as collections; it does not by itself grant or deny access to individual documents or fields. This demo combines that database-level gate with a MongoDB view whose aggregation pipeline shapes the rows and fields returned. Alice and Bob receive `find` on `secdemo.secview`, not `secdemo.data`.

### RBAC and role-scoped document access

The setup assigns Alice the `OPERATION_A` role and Bob the `OPERATION_B` role. Choose **Role-scoped rows** in the pipeline examples and apply it. Its `$match` reads the querying database user's assigned role names from `$$USER_ROLES` and compares them with each document's `op` field. Documents without an `op` value are visible to both; operation-tagged records are visible only to a matching role. Switch Alice/Bob and reload the view to see rows change without rewriting documents. Here the roles provide the user's authorization attributes and the view applies the row policy. The roles themselves deliberately do not grant access to the source collection.

### ABAC: document attributes plus current time

Choose **Age + time (ABAC)** and apply it. The policy returns documents only when `age > 18` and `availableFrom <= $$NOW`. Setup provides an underage record, an adult available now, and an adult scheduled to become available 24 hours after setup. `$$NOW` is MongoDB's current-time aggregation variable; waiting until the scheduled time changes the result without changing the policy or rewriting that record. Changing the pipeline policy also leaves source documents untouched.

### Field-level shaping

Choose **Mask secret source field** to keep matching documents while replacing `source` for secret records. Other examples such as **Project** and **Array** demonstrate removing fields or filtering sensitive nested fields. This is field-level shaping by the view pipeline; the users still cannot query the underlying collection directly.

These are demonstrations of read policies, not a claim that MongoDB collection-level roles alone provide row/field security. The security boundary for these examples is the database user being limited to the view and querying it under that user's identity. The app's admin-backed pipeline editor is intentionally a demo interface; treat its operators as trusted administrators and do not expose it as a production policy-management endpoint.

## Troubleshooting

- **Setup cannot connect:** Check that the URI is valid, the cluster is reachable, and the account has the permissions listed above. Setup intentionally suppresses detailed driver errors so a URI/password cannot accidentally be written to logs.
- **App is not configured:** Run `npm run setup` again and enter the cluster URI when prompted.
- **App cannot connect after setup:** Confirm the cluster remains reachable and the credentials in the ignored `config/local.json` file have not been changed or revoked. If they have, rerun setup.
