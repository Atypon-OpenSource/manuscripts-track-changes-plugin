/*!
 * © 2025 Atypon Systems LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Transaction, EditorState, PluginKey } from 'prosemirror-state'
import { getAction, TrackChangesAction } from './actions'
import { processStepsBeforeTracking } from './tracking/lib/processStepsBeforeTracking'
import { trackTransaction } from './tracking/trackTransaction'
import { TrTrackingContext } from './types/track'
import {
  trFromHistory,
  getMoveOperationsSteps,
  getIndentationOperationSteps,
  filterMeaninglessMoveSteps,
  changeMovedToInsertsOnSourceDeletion,
} from './utils/tracking'

export function trackChanges(
  tr: Transaction,
  createdTr: Transaction,
  oldState: EditorState,
  userID: string,
  skipTrsWithMetas: (string | PluginKey<any>)[]
) {
  const wasAppended = tr.getMeta('appendedTransaction') as Transaction | undefined
  const skipMetaUsed = skipTrsWithMetas.some((m) => tr.getMeta(m) || wasAppended?.getMeta(m))
  const skipTrackUsed =
    getAction(tr, TrackChangesAction.skipTrack) ||
    (wasAppended && getAction(wasAppended, TrackChangesAction.skipTrack))

  if (
    tr.docChanged &&
    !skipMetaUsed &&
    !skipTrackUsed &&
    !trFromHistory(tr) &&
    !(wasAppended && tr.getMeta('origin') === 'paragraphs')
  ) {
    const action = getAction(tr, TrackChangesAction.indentationAction)?.action
    const trContext: TrTrackingContext = {
      action,
      stepsByGroupIDMap: new Map(),
    }
    const clearedSteps = processStepsBeforeTracking(tr, trContext, [
      getMoveOperationsSteps,
      getIndentationOperationSteps,
      filterMeaninglessMoveSteps,
    ])
    changeMovedToInsertsOnSourceDeletion(tr, createdTr, trContext)
    return trackTransaction(tr, oldState, createdTr, userID, clearedSteps, trContext)
  }
}
