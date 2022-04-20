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
  Selection,
  NodeSelection,
  TextSelection,
  Transaction,
} from 'prosemirror-state'
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform'

import { log } from '../utils/logger'
import { CHANGE_STATUS } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import { trackReplaceAroundStep } from './steps/trackReplaceAroundStep'
import { trackReplaceStep } from './steps/trackReplaceStep'

/**
 * Retrieves a static property from Selection class instead of having to use direct imports
 *
 * This skips the direct dependency to prosemirror-state where multiple versions might cause conflicts
 * as the created instances might belong to different prosemirror-state import than one used in the editor.
 * @param sel
 * @param doc
 * @param from
 * @returns
 */
const getSelectionStaticCreate = (sel: Selection, doc: PMNode, from: number) =>
  Object.getPrototypeOf(sel).constructor.create(doc, from)

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
 * @param userID User id
 * @returns newTr that inverts the initial tr and applies track attributes/marks
 */
export function trackTransaction(
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  userID: string
) {
  const emptyAttrs: NewEmptyAttrs = {
    userID,
    createdAt: tr.time,
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
      const selectionPos = trackReplaceStep(step, oldState, newTr, emptyAttrs)
      if (!wasNodeSelection) {
        newTr.setSelection(getSelectionStaticCreate(tr.selection, newTr.doc, selectionPos))
      }
    } else if (step instanceof ReplaceAroundStep) {
      trackReplaceAroundStep(step, oldState, newTr, emptyAttrs)
      // } else if (step instanceof AddMarkStep) {
      // } else if (step instanceof RemoveMarkStep) {
    }
    // TODO: here we could check whether adjacent inserts & deletes cancel each other out.
    // However, this should not be done by diffing and only matching node or char by char instead since
    // it's A easier and B more intuitive to user.
    const { meta } = tr as Transaction & {
      meta: Record<string, any>
    }
    // This is quite non-optimal in some sense but to ensure no information is lost
    // we have to re-add all the old meta keys, such as inputType or uiEvent.
    // This should prevent bugs incase other plugins/widgets rely upon them existing (and they
    // are not able to process the transactions before track-changes).
    // TODO: will this cause race-condition if a meta causes another appendTransaction to fire
    Object.keys(meta).forEach((key) => newTr.setMeta(key, tr.getMeta(key)))
  })
  // This is kinda hacky solution at the moment to maintain NodeSelections over transactions
  // These are required by at least cross-references that need it to activate the selector pop-up
  if (wasNodeSelection) {
    const mappedPos = newTr.mapping.map(tr.selection.from)
    const resPos = newTr.doc.resolve(mappedPos)
    const nodePos = mappedPos - (resPos.nodeBefore?.nodeSize || 0)
    newTr.setSelection(getSelectionStaticCreate(tr.selection, newTr.doc, nodePos))
  }
  log.info('NEW transaction', newTr)
  return newTr
}
