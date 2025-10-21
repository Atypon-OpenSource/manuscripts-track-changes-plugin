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

import { NodeSelection as NodeSelectionClass, TextSelection, Transaction, Selection } from 'prosemirror-state'
import { Mapping, ReplaceStep } from 'prosemirror-transform'
import { TrTrackingContext } from '../types/track'
import { isStructuralChange } from '../changes/qualifiers'

/**
 * Retrieves a static property from Selection class instead of having to use direct imports
 *
 * This skips the direct dependency to prosemirror-state where multiple versions might cause conflicts
 * as the created instances might belong to different prosemirror-state import than one used in the editor.
 * @param sel
 * @returns
 */
export const getSelectionStaticConstructor = (sel: Selection) => Object.getPrototypeOf(sel).constructor

export function fixAndSetSelectionAfterTracking(
  newTr: Transaction,
  oldTr: Transaction,
  deletedNodeMapping: Mapping,
  trContext: TrTrackingContext
) {
  const wasNodeSelection = oldTr.selection instanceof NodeSelectionClass

  if (!wasNodeSelection && !oldTr.selectionSet && trContext.selectionPosFromInsertion) {
    const sel: typeof Selection = getSelectionStaticConstructor(oldTr.selection)
    // Use Selection.near to fix selections that point to a block node instead of inline content
    // eg when inserting a complete new paragraph. -1 finds the first valid position moving backwards
    // inside the content

    const near: Selection = sel.near(newTr.doc.resolve(trContext.selectionPosFromInsertion), -1)
    newTr.setSelection(near)
  }

  if (oldTr.selectionSet && oldTr.selection instanceof TextSelection) {
    let from = oldTr.selection.from
    if (isStructuralChange(oldTr)) {
      // this mapping will capture invert mapping of delete steps as that what plugin do, also will map the actual
      // deleted nodes mapping in deleteNode.ts
      const selectionMapping = new Mapping()
      oldTr.steps.map((step) => {
        const isDeleteStep = step instanceof ReplaceStep && step.from !== step.to && step.slice.size === 0
        if (isDeleteStep) {
          selectionMapping.appendMap(step.getMap().invert())
        }
      })
      selectionMapping.appendMapping(deletedNodeMapping)
      from = selectionMapping.map(oldTr.selection.from)
    }
    // preserving text selection if we track an element in which selection is set
    const newPos = newTr.doc.resolve(from)
    newTr.setSelection(new TextSelection(newPos))
  }
  // This is kinda hacky solution at the moment to maintain NodeSelections over transactions
  // These are required by at least cross-references and links to activate their selector pop-ups
  if (wasNodeSelection) {
    // And -1 here is necessary to keep the selection pointing at the start of the node
    // (or something, breaks with cross-references otherwise)
    const mappedPos = newTr.mapping.map(oldTr.selection.from, -1)
    const sel: typeof NodeSelectionClass = getSelectionStaticConstructor(oldTr.selection)
    newTr.setSelection(sel.create(newTr.doc, mappedPos))
  }
  return newTr
}
