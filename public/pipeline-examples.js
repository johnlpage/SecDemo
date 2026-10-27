// Pipeline examples configuration
const PIPELINE_EXAMPLES = {
    confidential: {
        label: 'Confidential',
        description: 'Show only confidential documents',
        code: `pipeline = [  
  { $match: { classification: 'confidential' } }  
];`
    },
    secret: {
        label: 'Secret',
        description: 'Show only secret documents',
        code: `pipeline = [  
  { $match: { classification: 'secret' } }  
];`
    },
    both: {
        label: 'Both',
        description: 'Show confidential and secret documents',
        code: `  
pipeline = [  
  { $match: {  
    classification: { $in: ['confidential', 'secret'] }}  
    }  
];`
    },
    projection: {
        label: 'Project',
        description: 'Show only specific fields',
        code: `pipeline = [  
  { $match: { classification: 'confidential' } },  
  { $project: { name: 1, classification: 1, _id: 0 }}  
];`
    },
    read_in: {
        label: 'Read In',
        description: 'Dynamic access based on user roles',
        code: `  
let hasNoOp = { $in:[ { $type: "$op"},["null","missing"]]} ;  
  
let readIn =  { $in: ["$op",  
                      "$$USER_ROLES.role" ]};  
  
pipeline = [  
{ $match: { $expr: { $or: [ hasNoOp, readIn ]}}},  
{  
    $project: {  
      source: 0  
    }  
  }  
]  
`
    },
    dynamic: {
        label: 'Dynamic',
        description: 'Conditional field masking',
        code: `  
let isSecret = {  
    $eq: ["$classification", "secret"]  
};  
  
pipeline = [{  
    $set: {  
        source: {  
            "$cond": {  
                if: isSecret,  
                then: "",  
                else: "$source"  
            }  
        }  
    }  
}];  
`
    },
    array: {
        label: 'Array',
        description: 'Filter Array Elements',
        code: `

let notSecret =  { "$ne": [
                  "$$paragraph.classification",
                  "secret"  ]};
                  
let withoutSecrets = { "$filter": {
              "input": "$paragraphs",
              "as": "paragraph",
              "cond": notSecret } };
               
pipeline = [
      { "$set": {
          "paragraphs":withoutSecrets
          } }
]
`
    },
    redact: {
        label: '$redact',
        description: 'Recursive redaction',
        code: `
let notSecret =  { "$ne": [
                  "$classification",
                  "secret"  ]};
pipeline = [
      { $redact: {
        $cond: {
           if: notSecret,
           then: "$$DESCEND",
           else: "$$PRUNE"
         }
       }
     }
]
`
    },
    roleScoped: {
        label: 'Role-scoped rows',
        description: 'Filter documents using each database user’s assigned operation role',
        code: `pipeline = [
  { "$match": { "$expr": { "$or": [
    { "$eq": [{ "$type": "$op" }, "missing"] },
    { "$in": ["$op", "$$USER_ROLES.role"] }
  ] } } }
];`
    },
    ageAndTime: {
        label: 'Age + time (ABAC)',
        description: 'Allow adults only after the record availability time',
        code: `pipeline = [
  { "$match": { "$expr": { "$and": [
    { "$gt": ["$age", 18] },
    { "$lte": ["$availableFrom", "$$NOW"] }
  ] } } }
];`
    },
    maskSecretSource: {
        label: 'Mask secret source field',
        description: 'Keep documents but redact source on secret records',
        code: `pipeline = [
  { "$set": { "source": { "$cond": [
    { "$eq": ["$classification", "secret"] },
    "[REDACTED]",
    "$source"
  ] } } }
];`
    }
};
