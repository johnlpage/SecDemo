const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DATABASE_NAME = 'secdemo';
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'local.json');

function promptForUri() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('Run `npm run setup` from an interactive terminal to enter the cluster URI securely.');
    }

    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        stdout.write('MongoDB cluster URI (input hidden): ');
        let value = '';

        function onData(buffer) {
            for (const byte of buffer) {
                if (byte === 3) {
                    cleanup();
                    stdout.write('\nSetup cancelled.\n');
                    reject(new Error('Setup cancelled.'));
                    return;
                }
                if (byte === 13 || byte === 10) {
                    cleanup();
                    stdout.write('\n');
                    resolve(value.trim());
                    return;
                }
                if (byte === 8 || byte === 127) {
                    value = value.slice(0, -1);
                } else {
                    value += Buffer.from([byte]).toString('utf8');
                }
            }
        }

        function cleanup() {
            stdin.removeListener('data', onData);
            if (stdin.isTTY) stdin.setRawMode(false);
            stdin.pause();
        }

        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}

function makeAppUri(adminUri) {
    const appUri = new URL(adminUri);
    appUri.username = '';
    appUri.password = '';
    appUri.searchParams.delete('authSource');
    return appUri.toString();
}

function newPassword() {
    return crypto.randomBytes(32).toString('base64url');
}

async function ensureRole(database, role, privileges) {
    const existing = await database.command({ rolesInfo: role });
    if (existing.roles && existing.roles.length) {
        await database.command({ updateRole: role, privileges, roles: [] });
    } else {
        await database.command({ createRole: role, privileges, roles: [] });
    }
}

async function ensureUser(database, username, password, roles) {
    const existing = await database.command({ usersInfo: username });
    if (existing.users && existing.users.length) {
        await database.command({ updateUser: username, pwd: password, roles });
    } else {
        await database.command({ createUser: username, pwd: password, roles });
    }
}

async function provision(client, adminUri) {
    const database = client.db(DATABASE_NAME);

    await ensureRole(database, 'OPERATION_A', []);
    await ensureRole(database, 'OPERATION_B', []);
    await ensureRole(database, 'readonly', [{
        resource: { db: DATABASE_NAME, collection: 'secview' },
        actions: ['find', 'listCollections']
    }]);

    let existingConfig = {};
    try {
        existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        // First setup, or the local config is unavailable: generate credentials below.
    }
    const alicePassword = existingConfig.users?.alice?.password || newPassword();
    const bobPassword = existingConfig.users?.bob?.password || newPassword();
    await ensureUser(database, 'alice', alicePassword, [
        { role: 'OPERATION_A', db: DATABASE_NAME },
        { role: 'readonly', db: DATABASE_NAME }
    ]);
    await ensureUser(database, 'bob', bobPassword, [
        { role: 'OPERATION_B', db: DATABASE_NAME },
        { role: 'readonly', db: DATABASE_NAME }
    ]);

    const documents = database.collection('data');
    if (await documents.countDocuments() === 0) {
        await documents.insertMany([
            { name: 'Document 1', source: 'john', op: 'OPERATION_B', classification: 'public', content: 'This is public information' },
            { name: 'Document 2', source: 'paul', classification: 'confidential', content: 'This is confidential information' },
            { name: 'Document 3', source: 'george', classification: 'secret', content: 'This is secret information' },
            { name: 'Document 4', op: 'OPERATION_B', source: 'ringo', classification: 'confidential', content: 'Another confidential document' },
            {
                name: 'Document 5', op: 'OPERATION_B', source: 'ringo', classification: 'confidential',
                paragraphs: [
                    { txt: 'This is some confidential information', classification: 'confidential' },
                    { txt: 'This is some secret information', classification: 'secret' },
                    { txt: 'This is more confidential information', classification: 'confidential' }
                ]
            }
        ]);
    }

    const now = Date.now();
    await documents.bulkWrite([
        {
            updateOne: {
                filter: { _id: 'demo-age-minor' },
                update: { $set: {
                    name: 'Age policy example: minor', classification: 'policy-example',
                    age: 17, availableFrom: new Date(now - 24 * 60 * 60 * 1000),
                    content: 'Age 17; available now'
                } },
                upsert: true
            }
        },
        {
            updateOne: {
                filter: { _id: 'demo-age-adult' },
                update: { $set: {
                    name: 'Age policy example: adult', classification: 'policy-example',
                    age: 25, availableFrom: new Date(now - 24 * 60 * 60 * 1000),
                    content: 'Age 25; available now'
                } },
                upsert: true
            }
        },
        {
            updateOne: {
                filter: { _id: 'demo-time-embargo' },
                update: { $set: {
                    name: 'Time policy example: future release', classification: 'policy-example',
                    age: 32, availableFrom: new Date(now + 24 * 60 * 60 * 1000),
                    content: 'Age 32; available 24 hours after setup'
                } },
                upsert: true
            }
        }
    ]);

    const views = await database.listCollections({ name: 'secview' }).toArray();
    if (views.length) await database.collection('secview').drop();
    await database.createCollection('secview', {
        viewOn: 'data',
        pipeline: [{ $match: { classification: 'confidential' } }]
    });

    const localConfig = {
        mongoUrl: makeAppUri(adminUri),
        adminUri,
        databaseName: DATABASE_NAME,
        users: {
            alice: {
                username: 'alice',
                password: alicePassword,
                description: 'Read-only view user with the OPERATION_A role'
            },
            bob: {
                username: 'bob',
                password: bobPassword,
                description: 'Read-only view user with the OPERATION_B role'
            },
            admin: { description: 'Administrative account used for demo setup and view management' }
        },
        defaultUser: 'alice'
    };

    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(localConfig, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(CONFIG_PATH, 0o600);
}

async function main() {
    const uri = await promptForUri();
    if (!uri) throw new Error('A MongoDB cluster URI is required.');
    let parsed;
    try {
        parsed = new URL(uri);
    } catch {
        throw new Error('The cluster URI is not a valid MongoDB URI.');
    }
    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) {
        throw new Error('The cluster URI must use mongodb:// or mongodb+srv://.');
    }

    const client = new MongoClient(uri);
    try {
        await client.connect();
        // Keep URI and server errors private: drivers may include credentials in errors.
        await provision(client, uri);
        console.log('Setup complete. Demo users, sample data, and the initial view are ready.');
        console.log('Generated credentials were saved locally with restricted file permissions and were not displayed.');
        console.log('Run `npm start` and open http://localhost:3000.');
    } finally {
        await client.close();
    }
}

main().catch((error) => {
    if (error.message === 'Setup cancelled.') return;
    console.error('Setup failed. Check the cluster URI, connectivity, and that its user can create/update roles and users, insert documents, and create/drop views. Details are omitted to avoid exposing connection credentials.');
    process.exitCode = 1;
});
