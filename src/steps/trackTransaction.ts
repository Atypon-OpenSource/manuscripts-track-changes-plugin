/*!
 * © 2021 Atypon Systems LLC
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
import { Node as PMNode } from 'prosemirror-model'
import type {
  EditorState,
  NodeSelection,
  TextSelection,
  Selection,
  Transaction,
} from 'prosemirror-state'
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform'

import { log } from '../utils/logger'
import { CHANGE_STATUS } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import { trackReplaceAroundStep } from './trackReplaceAroundStep'
import { trackReplaceStep } from './trackReplaceStep'
import { processChangeSteps } from '../change-steps/processChangeSteps'
import { diffChangeSteps } from '../change-steps/diffChangeSteps'
import { InsertSliceStep } from '../types/step'
import { ExposedReplaceStep } from '../types/pm'
/**
 * Retrieves a static property from Selection class instead of having to use direct imports
 *
 * This skips the direct dependency to prosemirror-state where multiple versions might cause conflicts
 * as the created instances might belong to different prosemirror-state import than one used in the editor.
 * @param sel
 * @returns
 */
const getSelectionStaticConstructor = (sel: Selection) => Object.getPrototypeOf(sel).constructor

const isHighlightMarkerNode = (node: PMNode): node is PMNode =>
  node && node.type === node.type.schema.nodes.highlight_marker

/**
 * Inverts transactions to wrap their contents/operations with track data instead
 *
 * The main function of track changes that holds the most complex parts of this whole library.
 * Takes in as arguments the data from appendTransaction to reapply it with the track marks/attributes.
 * We could prevent the initial transaction from being applied all together but since invert works just
 * as well and we can use the intermediate doc for checking which nodes are changed, it's not prevented.
 *
 *
 * @param tr Original transaction
 * @param oldState State before transaction
 * @param newTr Transaction created from the new editor state
 * @param authorID User id
 * @returns newTr that inverts the initial tr and applies track attributes/marks
 */
export function trackTransaction(
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  authorID: string
) {
  const emptyAttrs: NewEmptyAttrs = {
    authorID,
    reviewedByID: null,
    createdAt: tr.time,
    updatedAt: tr.time,
    status: CHANGE_STATUS.pending,
  }
  // Must use constructor.name instead of instanceof as aliasing prosemirror-state is a lot more
  // difficult than prosemirror-transform
  const wasNodeSelection = tr.selection.constructor.name === 'NodeSelection'
  let iters = 0
  log.info('ORIGINAL transaction', tr)
  tr.steps.forEach((step) => {
    log.info('transaction step', step)
    iters += 1
    if (iters > 20) {
      console.error(
        '@manuscripts/track-changes-plugin: Possible infinite loop in iterating tr.steps, tracking skipped!\n' +
          'This is probably an error with the library, please report back to maintainers with a reproduction if possible',
        newTr
      )
      return
    } else if (!(step instanceof ReplaceStep) && step.constructor.name === 'ReplaceStep') {
      console.error(
        '@manuscripts/track-changes-plugin: Multiple prosemirror-transform packages imported, alias/dedupe them ' +
          'or instanceof checks fail as well as creating new steps'
      )
      return
    } else if (step instanceof ReplaceStep) {
      const { slice } = step as ExposedReplaceStep
      if (
        slice?.content?.content?.length === 1 &&
        isHighlightMarkerNode(slice.content.content[0])
      ) {
        // don't track highlight marker nodes
        return
      }
      let [steps, startPos] = trackReplaceStep(step, oldState, newTr, emptyAttrs)
      if (steps.length === 1) {
        const step: any = steps[0] // eslint-disable-line @typescript-eslint/no-explicit-any
        if (isHighlightMarkerNode(step?.node || step?.slice?.content?.content[0])) {
          // don't track deleted highlight marker nodes
          return
        }
      }
      log.info('CHANGES: ', steps)
      // deleted and merged really...
      const deleted = steps.filter((s) => s.type !== 'insert-slice')
      const inserted = steps.filter((s) => s.type === 'insert-slice') as InsertSliceStep[]
      steps = diffChangeSteps(deleted, inserted)
      log.info('DIFFED STEPS: ', steps)
      const [mapping, selectionPos] = processChangeSteps(
        steps,
        startPos || tr.selection.head, // Incase startPos is it's default value 0, use the old selection head
        newTr,
        emptyAttrs,
        oldState.schema
      )
      if (!wasNodeSelection) {
        const sel: typeof Selection = getSelectionStaticConstructor(tr.selection)
        // Use Selection.near to fix selections that point to a block node instead of inline content
        // eg when inserting a complete new paragraph. -1 finds the first valid position moving backwards
        // inside the content
        const near: Selection = sel.near(newTr.doc.resolve(selectionPos), -1)
        newTr.setSelection(near)
      }
    } else if (step instanceof ReplaceAroundStep) {
      let steps = trackReplaceAroundStep(step, oldState, newTr, emptyAttrs)
      const deleted = steps.filter((s) => s.type !== 'insert-slice')
      const inserted = steps.filter((s) => s.type === 'insert-slice') as InsertSliceStep[]
      log.info('INSERT STEPS: ', inserted)
      steps = diffChangeSteps(deleted, inserted)
      log.info('DIFFED STEPS: ', steps)
      const [mapping, selectionPos] = processChangeSteps(
        steps,
        tr.selection.from,
        newTr,
        emptyAttrs,
        oldState.schema
      )
    }
    // } else if (step instanceof AddMarkStep) {
    // } else if (step instanceof RemoveMarkStep) {
    // TODO: here we could check whether adjacent inserts & deletes cancel each other out.
    // However, this should not be done by diffing and only matching node or char by char instead since
    // it's A easier and B more intuitive to user.

    // The old meta keys are not copied to the new transaction since this will cause race-conditions
    // when a single meta-field is expected to having been processed / removed. Generic input meta keys,
    // inputType and uiEvent, are re-added since some plugins might depend on them and process the transaction
    // after track-changes plugin.
    tr.getMeta('inputType') && newTr.setMeta('inputType', tr.getMeta('inputType'))
    tr.getMeta('uiEvent') && newTr.setMeta('uiEvent', tr.getMeta('uiEvent'))
  })
  // This is kinda hacky solution at the moment to maintain NodeSelections over transactions
  // These are required by at least cross-references and links to activate their selector pop-ups
  if (wasNodeSelection) {
    // And -1 here is necessary to keep the selection pointing at the start of the node
    // (or something, breaks with cross-references otherwise)
    const mappedPos = newTr.mapping.map(tr.selection.from, -1)
    const sel: typeof NodeSelection = getSelectionStaticConstructor(tr.selection)
    newTr.setSelection(sel.create(newTr.doc, mappedPos))
  }
  log.info('NEW transaction', newTr)
  return newTr
}
