/*!
 * canvas-comments-kit — threaded-comment overlay for canvas / SVG apps, with a
 * bring-your-own backend. See README.md.
 */
export { createComments, screenOffset } from './comments.js';
export { defineBackend, CONTRACT } from './backend.js';
export { localStorageBackend, makeLocalStore } from './backends/local.js';
export { memoryBackend } from './backends/memory.js';
export { httpBackend } from './backends/http.js';
export { default } from './comments.js';
