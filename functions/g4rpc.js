// SPDX-License-Identifier: AGPL-3.0-or-later
// Preview adapter for the standalone gateway. Production Postern routing is separate.
import { handleGateway } from '../gateway/worker.js';
export const onRequest = context => handleGateway(context.request, context.env, context);
