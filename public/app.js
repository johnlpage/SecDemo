const { createApp } = Vue;

createApp({
    data() {
        return {
            currentUser: { username: 'alice', description: '' },
            availableUsers: [],
            collectionData: null,
            viewResults: null,
            viewQuery: '{}',
            pipelineCode: `pipeline = [  
  { $match: { classification: 'confidential' } }  
];`,
            currentViewDef: null,
            userInfo: null,
            testResult: null,
            error: null,
            viewError: null,
            viewDefError: null,
            pipelineExamples: PIPELINE_EXAMPLES
        }
    },
    async mounted() {
        await this.getCurrentUser();
        await this.loadAvailableUsers();
        await this.loadData();
        await this.loadViewResults();

        // Apply syntax highlighting after Vue renders
        this.$nextTick(() => {
            if (window.Prism) {
                Prism.highlightAll();
            }
        });
    },
    async updated() {
        // Re-apply highlighting when data changes
        this.$nextTick(() => {
            if (window.Prism) {
                Prism.highlightAll();
            }
        });
    },
    methods: {
        async getCurrentUser() {
            try {
                const response = await fetch('/api/current-user');
                const data = await response.json();
                this.currentUser = data;
            } catch (err) {
                this.error = err.message;
            }
        },

        async loadAvailableUsers() {
            try {
                const response = await fetch('/api/available-users');
                this.availableUsers = await response.json();
            } catch (err) {
                this.error = err.message;
            }
        },

        async switchUser(username) {
            try {
                const response = await fetch('/api/switch-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username })
                });
                const data = await response.json();
                if (data.success) {
                    this.currentUser = {
                        username: data.username,
                        description: data.description
                    };
                    this.error = null;
                    this.viewError = null;
                    await this.loadViewResults();
                }
            } catch (err) {
                this.error = err.message;
            }
        },

        async loadUsers() {
            try {
                const response = await fetch('/api/users');
                this.userInfo = await response.json();
            } catch (err) {
                this.error = err.message;
            }
        },

        async loadData() {
            try {
                this.error = null;
                const response = await fetch('/api/data');
                if (response.ok) {
                    this.collectionData = await response.json();
                } else {
                    const errorData = await response.json();
                    this.error = errorData.error;
                }
            } catch (err) {
                this.error = err.message;
            }
        },

        async loadViewResults() {
            try {
                this.viewError = null;
                const url = '/api/view-results';
                const response = await fetch(url);
                if (response.ok) {
                    this.viewResults = await response.json();
                } else {
                    const errorData = await response.json();
                    this.viewError = errorData.error;
                }
            } catch (err) {
                this.viewError = err.message;
            }
        },

        async executeViewQuery() {
            try {
                this.viewError = null;
                const query = JSON.parse(this.viewQuery);
                const queryString = encodeURIComponent(JSON.stringify(query));
                const response = await fetch(`/api/view-results?query=${queryString}`);
                if (response.ok) {
                    this.viewResults = await response.json();
                } else {
                    const errorData = await response.json();
                    this.viewError = errorData.error;
                }
            } catch (err) {
                this.viewError = `Query error: ${err.message}`;
            }
        },

        clearQuery() {
            this.viewQuery = '{}';
            this.loadViewResults();
        },

        async loadViewDefinition() {
            try {
                this.viewDefError = null;
                const response = await fetch('/api/view-definition');
                if (response.ok) {
                    this.currentViewDef = await response.json();
                } else {
                    const errorData = await response.json();
                    this.viewDefError = errorData.error;
                }
            } catch (err) {
                this.viewDefError = err.message;
            }
        },

        async testPipeline() {
            try {
                this.testResult = null;
                const response = await fetch('/api/test-pipeline', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsCode: this.pipelineCode })
                });

                this.testResult = await response.json();
            } catch (err) {
                this.testResult = { success: false, error: err.message };
            }
        },

        async updateView() {
            try {
                this.viewDefError = null;
                const response = await fetch('/api/view-definition', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsCode: this.pipelineCode })
                });

                if (response.ok) {
                    const result = await response.json();
                    this.testResult = { success: true, message: result.message, pipeline: result.pipeline };
                    await this.loadViewDefinition();
                    await this.loadViewResults();
                } else {
                    const errorData = await response.json();
                    this.viewDefError = errorData.error;
                }
            } catch (err) {
                this.viewDefError = err.message;
            }
        },

        setPipelineExample(key) {
            const example = this.pipelineExamples[key];
            if (example && example.code) {
                this.pipelineCode = example.code;
                this.testResult = null;
            }
        }
    }
}).mount('#app');
