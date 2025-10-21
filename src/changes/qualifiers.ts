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
import { Node as PMNode, Slice } from 'prosemirror-model'
import { Selection, Transaction } from 'prosemirror-state'
import { ReplaceStep, Step } from 'prosemirror-transform'

import { TrackChangesAction } from '../actions'
import { CHANGE_OPERATION, TrackedAttrs, TrackedChange } from '../types/change'
import { ChangeSet } from '../ChangeSet'

export const isStructuralChange = (tr: Transaction) =>
  tr.getMeta(TrackChangesAction.structuralChangeAction) &&
  tr.steps.length === 2 &&
  tr.steps[0] instanceof ReplaceStep &&
  tr.steps[1] instanceof ReplaceStep

/**
 * Checks if this is a direct pending move deletion (not part of multiple moves)
 *
 * A direct pending move deletion occurs when:
 * 1. The step is a deletion (from ≠ to and empty slice)
 * 2. The step is not part of a larger move operation (not in movingSteps map)
 * 3. The deleted node has pending move tracking attributes
 *
 * This is different from move operations that involve multiple steps (like cut-paste)
 * where we need to track the relationship between deletion and insertion.
 */
export const isDirectPendingMoveDeletion = (
  step: ReplaceStep,
  doc: PMNode,
  movingSteps: Map<ReplaceStep, string>
): boolean => {
  // Not a deletion
  if (step.from === step.to || step.slice.content.size > 0) {
    return false
  }

  // Part of a move operation
  if (movingSteps.has(step)) {
    return false
  }

  const node = doc.nodeAt(step.from)
  if (!node) {
    return false
  }

  return ChangeSet.isPendingChange(
    node.attrs.dataTracked as TrackedAttrs[] | undefined,
    CHANGE_OPERATION.move
  )
}
