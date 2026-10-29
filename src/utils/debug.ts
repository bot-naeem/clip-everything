// Vendored from obsidian-clipper. The extension read its debug flag from
// browser.storage; the CLI has no storage, so debug logging stays off.
declare const DEBUG_MODE: boolean;

const DEBUG_FLAG: boolean = typeof DEBUG_MODE !== 'undefined' ? DEBUG_MODE : false;
const debugMode: boolean = DEBUG_FLAG;

export const toggleDebug = (_filterName: string) => {
	// No-op outside the browser extension.
};

export const debugLog = (filterName: string, ...args: any[]) => {
	if (DEBUG_FLAG && debugMode) {
		console.log(`[${filterName}]`, ...args);
	}
};

export const isDebugMode = () => DEBUG_FLAG && debugMode;
