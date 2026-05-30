export const state = {
    mode: "server", // "server" | "browser" | "demo"
    vaultLabel: "",
    appVersion: null, // will be set on app.js
    selectedDir: null,
    rootHandle: null,
    expandedDirs: new Set([""]),
    childrenByDir: new Map(), // dir -> entries[]
    activeFile: null,
    activeFileContent: "",
    sourceMode: false,
    activeInlineLine: null,
    activeInlineSelectionStart: null,
    activeInlineSelectionEnd: null,
    inlineEditSkipBlur: false,
    lineNumbers: false,
    dirty: false,
    filter: "",
    autosaveTimer: null,
    autosaveInFlight: false,
    autosaveQueued: false,
    draggingPath: null,
    draggingType: null,
    movingPath: null,
    moveInProgress: false,
    fileIndex: null,
    fileIndexPromise: null
};


