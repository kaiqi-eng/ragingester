import { BAYS_WORKFLOW_NAME } from './constants.js';

/**
 * @typedef {Object} PipelineErrorPayload
 * @property {string} workflow
 * @property {string} failedNode
 * @property {string} errorClass
 * @property {string} error
 * @property {string} executionId
 * @property {string} time
 * @property {string} autoAction
 * @property {string} [mention]
 */

/**
 * @param {PipelineErrorPayload} payload
 * @returns {string}
 */
export function pipelineErrorFallbackText(payload) {
  const lines = [
    'Bays — Pipeline Failure',
    `Workflow: ${payload.workflow}`,
    `Failed Node: ${payload.failedNode}`,
    `Error Class: ${payload.errorClass}`,
    `Error: ${payload.error}`,
    `Execution ID: ${payload.executionId}`,
    `Time: ${payload.time}`,
    `Auto-Action: ${payload.autoAction}`
  ];
  if (payload.mention) lines.push(payload.mention);
  return lines.join('\n');
}

/**
 * @param {PipelineErrorPayload} payload
 * @returns {{ blocks: object[] }}
 */
export function buildPipelineErrorBlocks(payload) {
  const sectionText = [
    `*Workflow:* ${payload.workflow || BAYS_WORKFLOW_NAME}`,
    `*Failed Node:* ${payload.failedNode}`,
    `*Error Class:* ${payload.errorClass}`,
    `*Error:* ${payload.error}`,
    `*Execution ID:* ${payload.executionId}`,
    `*Time:* ${payload.time}`,
    `*Auto-Action:* ${payload.autoAction}`
  ].join('\n');

  /** @type {object[]} */
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Bays — Pipeline Failure'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: sectionText
      }
    }
  ];

  if (payload.mention) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: payload.mention
        }
      ]
    });
  }

  return { blocks };
}
