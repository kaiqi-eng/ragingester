export class RunOverlapError extends Error {
  constructor(message = 'card already has an active run') {
    super(message);
    this.name = 'RunOverlapError';
    this.statusCode = 409;
  }
}
