declare const DEBUG_MODE: boolean;

const DEBUG_FLAG: boolean = typeof DEBUG_MODE !== 'undefined' ? DEBUG_MODE : false;
let debugMode: boolean = DEBUG_FLAG;

function getBrowserLike(): any | null {
	try {
		// Lazy require to avoid loading extension-only polyfill in Node CLI runtime.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return require('./browser-polyfill').default;
	} catch {
		return null;
	}
}

// Initialize debug mode from storage only in debug mode
if (DEBUG_FLAG) {
	const browserLike = getBrowserLike();
	browserLike?.storage?.local?.get('debugMode').then((result: { debugMode?: boolean }) => {
		debugMode = result.debugMode ?? false;
		console.log(`Debug mode initialized to: ${debugMode ? 'ON' : 'OFF'}`);
	}).catch((error) => {
		console.error('Error initializing debug mode:', error);
	});
}

export const toggleDebug = (filterName: string) => {
	if (!DEBUG_FLAG) return;
	debugMode = !debugMode;
	// Save the new state to storage
	const browserLike = getBrowserLike();
	browserLike?.storage?.local?.set({ debugMode }).then(() => {
		console.log(`${filterName} debug mode is now ${debugMode ? 'ON' : 'OFF'}`);
	}).catch((error) => {
		console.error('Error saving debug mode:', error);
	});
};

// Helper function for debug logging
export const debugLog = (filterName: string, ...args: any[]) => {
	if (DEBUG_FLAG && debugMode) {
		console.log(`[${filterName}]`, ...args);
	}
};

// Function to check if debug mode is on
export const isDebugMode = () => DEBUG_FLAG && debugMode;

// Expose toggleDebug to the global scope only in debug mode
if (DEBUG_FLAG && typeof window !== 'undefined') {
	(window as any).toggleDebug = toggleDebug;
}
