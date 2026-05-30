export const state = {
    mode: "server", // "server" | "browser" | "demo" 
    // -- "browser mode seems will never work due to security reason"
    
    vaultLabel: "",
    appVersion: null, // will be set on app.js

    selectedDir: null, 

    rootHandle: null,

    expandedDirs: new Set([""]),
    childrenByDir: new Map(), // dir -> entries[]

    activeFile: null,

    activeFileContent: "",

    // Live line-editor
    activeInlineLine: null,
    activeInlineSelectionStart: null,
    activeInlineSelectionEnd: null,
    inlineEditSkipBlur: false,
    // Additional
    lineNumbers: false,
    sourceMode: false,
    dirty: false,

    filter: "",
    // Auto-save
    autosaveTimer: null,
    autosaveInFlight: false,
    autosaveQueued: false,
    // Drag-n-drop
    draggingPath: null,
    draggingType: null,
    movingPath: null,
    moveInProgress: false,

    fileIndex: null,
    fileIndexPromise: null
};


