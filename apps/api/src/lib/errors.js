export class RunOverlapError extends Error {
  constructor(message = 'card already has an active run') {
    super(message);
    this.name = 'RunOverlapError';
    this.statusCode = 409;
  }
}

export class SourceCheckError extends Error {
  constructor(message = 'source check failed') {
    super(message);
    this.name = 'SourceCheckError';
    this.statusCode = 422;
  }
}
