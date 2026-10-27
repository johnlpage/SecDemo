const express = require('express');
const { MongoClient } = require('mongodb');
const vm = require('vm');

// Created by `npm run setup`; contains private, generated credentials.
let config;
try {
    config = require('./config/local.json');
} catch (error) {
    throw new Error('Demo is not configured. Run `npm run setup` and follow the prompts.');
}

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Configuration from credentials file
const MONGO_URL = config.mongoUrl;
const DB_NAME = config.databaseName;
const USERS = config.users;

let currentUser = config.defaultUser;

// Helper function to get MongoDB client with user credentials
async function getMongoClient(username) {
    if (username === 'admin') {
        const adminClient = new MongoClient(config.adminUri);
        await adminClient.connect();
        return adminClient;
    }

    const user = USERS[username];
    if (!user) throw new Error('Invalid user');

    const client = new MongoClient(MONGO_URL, {
        auth: { username: user.username, password: user.password },
        authSource: user.authSource || DB_NAME
    });
    await client.connect();
    return client;
}

// Helper function to evaluate JavaScript pipeline code safely
function evaluateJavaScript(jsCode) {

    try {
        // Create a sandbox context with safe globals
        const sandbox = {
            // MongoDB operators and functions
            $match: '$match',
            $project: '$project',
            $set: '$set',
            $group: '$group',
            $sort: '$sort',
            $limit: '$limit',
            $skip: '$skip',
            $lookup: '$lookup',
            $unwind: '$unwind',
            $addFields: '$addFields',
            $count: '$count',
            $facet: '$facet',
            $in: '$in',
            $ne: '$ne',
            $gt: '$gt',
            $lt: '$lt',
            $gte: '$gte',
            $lte: '$lte',
            $exists: '$exists',
            $regex: '$regex',
            $sum: '$sum',
            $expr: '$expr',
            $or: '$or',
            $and: '$and',
            $eq: '$eq',
            $cond: '$cond',
            $type: '$type',

            // Common JavaScript functions that are safe
            Date: Date,
            RegExp: RegExp,
            Array: Array,
            Object: Object,
            JSON: JSON,

            // Result variables to capture the pipeline
            pipeline: null,
            result: null,
            stages: null,
            aggregation: null,

            // Console for debugging (optional)
            console: {
                log: () => {} // Disabled for security
            }
        };

        // Clean up the code - remove extra whitespace and format properly
        const cleanCode = jsCode.trim();

        // Try different evaluation strategies
        let evaluatedPipeline = null;

        // Strategy 1: Direct execution
        try {
            const context = vm.createContext(sandbox);
            vm.runInContext(cleanCode, context, { timeout: 5000 });

            // Check various possible result variables
            evaluatedPipeline = context.pipeline || context.result || context.stages || context.aggregation;
        } catch (firstError) {
            console.error(firstError);
            // Strategy 2: Wrap in function and try to return result
            try {
                const wrappedCode = `  
          (function() {  
            ${cleanCode}  
            return pipeline || result || stages || aggregation;  
          })();  
        `;

                const context2 = vm.createContext(sandbox);
                evaluatedPipeline = vm.runInContext(wrappedCode, context2, { timeout: 5000 });
            } catch (secondError) {
                console.error(secondError);
                // Strategy 3: Try to evaluate as direct expression
                try {
                    // Remove any trailing semicolons and variable assignments
                    let expressionCode = cleanCode
                        .replace(/^\s*(?:pipeline|result|stages|aggregation)\s*=\s*/, '')
                        .replace(/;\s*$/, '');

                    const context3 = vm.createContext(sandbox);
                    evaluatedPipeline = vm.runInContext(expressionCode, context3, { timeout: 5000 });
                } catch (thirdError) {
                    // If all strategies fail, throw the most descriptive error
                    console.error(thirdError);
                    throw new Error(`Code evaluation failed. Original error: ${firstError.message}`);
                }
            }
        }

        // Validate the result
        if (!evaluatedPipeline) {
            throw new Error('No pipeline was generated. Make sure to assign the result to "pipeline" variable or return an array.');
        }

        if (!Array.isArray(evaluatedPipeline)) {
            throw new Error('Pipeline must be an array of aggregation stages.');
        }

        // Validate each stage in the pipeline
        for (let i = 0; i < evaluatedPipeline.length; i++) {
            const stage = evaluatedPipeline[i];
            if (typeof stage !== 'object' || stage === null) {
                throw new Error(`Pipeline stage ${i + 1} must be an object.`);
            }
        }

        return evaluatedPipeline;

    } catch (error) {
        throw new Error(`JavaScript evaluation failed: ${error.message}`);
    }
}


// Routes (keeping existing routes and adding pipeline evaluation)

// Get current user
app.get('/api/current-user', (req, res) => {
    const userInfo = USERS[currentUser];
    res.json({
        username: currentUser,
        description: userInfo ? userInfo.description : 'Unknown user'
    });
});

// Get available users (without passwords)
app.get('/api/available-users', (req, res) => {
    const availableUsers = Object.keys(USERS).map(key => ({
        username: key,
        description: USERS[key].description
    }));
    res.json(availableUsers);
});

// Switch user
app.post('/api/switch-user', (req, res) => {
    const { username } = req.body;
    if (USERS[username]) {
        currentUser = username;
        res.json({
            success: true,
            username: currentUser,
            description: USERS[username].description
        });
    } else {
        res.status(400).json({ error: 'Invalid user' });
    }
});

// Get all users and their info from MongoDB
app.get('/api/users', async (req, res) => {
    try {
        const client = await getMongoClient('admin');
        const db = client.db(DB_NAME);

        const users = await db.admin().command({ usersInfo: 1 });
        await client.close();

        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get collection data - ALWAYS use admin user
app.get('/api/data', async (req, res) => {
    try {
        const client = await getMongoClient('admin');
        const db = client.db(DB_NAME);
        const collection = db.collection('data');

        const documents = await collection.find({}).toArray();
        await client.close();

        res.json({
            note: "This data is accessed using admin credentials - regular users cannot see this",
            accessedBy: "admin",
            currentUser: currentUser,
            currentUserDescription: USERS[currentUser].description,
            documents: documents
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get view definition
app.get('/api/view-definition', async (req, res) => {
    try {

        const client = await getMongoClient('admin');
        const db = client.db(DB_NAME);

        const collections = await db.listCollections({ name: 'secview' }).toArray();
        await client.close();

        if (collections.length > 0) {
            res.json(collections[0]);
        } else {
            res.json({ message: 'View not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test JavaScript pipeline code
app.post('/api/test-pipeline', (req, res) => {
    try {
        const { jsCode } = req.body;
        const pipeline = evaluateJavaScript(jsCode);

        if (!Array.isArray(pipeline)) {
            throw new Error('Pipeline must be an array');
        }

        res.json({
            success: true,
            pipeline: pipeline,
            message: 'Pipeline code is valid'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Update view definition with JavaScript
app.post('/api/view-definition', async (req, res) => {
    try {
        const { jsCode } = req.body;

        // Evaluate the JavaScript to get the pipeline
        const pipeline = evaluateJavaScript(jsCode);

        if (!Array.isArray(pipeline)) {
            throw new Error('Pipeline must evaluate to an array');
        }

        const client = await getMongoClient('admin');
        const db = client.db(DB_NAME);

        // Drop existing view if it exists
        try {
            await db.collection('secview').drop();
        } catch (e) {
            // View might not exist, that's ok
        }

        // Create new view
        try {
            await db.createCollection('secview', {
                viewOn: 'data',
                pipeline: pipeline
            });
        } catch(error) {
            console.log( error.message );
        }

        await client.close();
        res.json({
            success: true,
            pipeline: pipeline,
            message: 'View updated successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get view results with optional query - use current user credentials
app.get('/api/view-results', async (req, res) => {
    try {
        // Use current user credentials to access the view
        const client = await getMongoClient(currentUser);
        const db = client.db(DB_NAME);
        const view = db.collection('secview');

        // Parse query from query string if provided
        let query = {};
        if (req.query.query) {
            try {
                query = JSON.parse(req.query.query);
            } catch (e) {
                await client.close();
                return res.status(400).json({ error: 'Invalid query JSON' });
            }
        }

        const results = await view.find(query).toArray();
        await client.close();

        // Add metadata to show which user accessed this
        res.json({
            note: `View accessed by user: ${currentUser}`,
            accessedBy: currentUser,
            userDescription: USERS[currentUser].description,
            query: query,
            results: results
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Get view results - use current user credentials
app.get('/api/view-results', async (req, res) => {
    try {
        const client = await getMongoClient(currentUser);
        const db = client.db(DB_NAME);
        const view = db.collection('secview');

        const results = await view.find({}).toArray();
        await client.close();

        res.json({
            note: `View accessed by user: ${currentUser}`,
            accessedBy: currentUser,
            userDescription: USERS[currentUser].description,
            results: results
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        currentUser: currentUser,
        availableUsers: Object.keys(USERS),
        mongoUrl: MONGO_URL,
        database: DB_NAME
    });
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Database: ${DB_NAME}`);
    console.log(`Available users: ${Object.keys(USERS).join(', ')}`);
});
