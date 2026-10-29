'use strict';

/**
 * Error that carries the pipeline stage it happened in.
 * Stages: start | navigate | wait | extract | transform | write
 */
class StageError extends Error {
	constructor(stage, message, cause) {
		super(message);
		this.name = 'StageError';
		this.stage = stage;
		if (cause !== undefined) {
			this.cause = cause;
		}
	}
}

module.exports = { StageError };
