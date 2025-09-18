/*!
 * © 2023 Atypon Systems LLC
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
import {
  EditorState,
  NodeSelection,
  NodeSelection as NodeSelectionClass,
  Selection,
  TextSelection,
  Transaction,
} from 'prosemirror-state'
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  Mapping,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Step,
} from 'prosemirror-transform'

import { getAction, TrackChangesAction } from '../actions'
import { diffChangeSteps } from '../change-steps/diffChangeSteps'
import { processChangeSteps } from '../change-steps/processChangeSteps'
import { updateChangeAttrs } from '../changes/updateChangeAttrs'
import { ChangeSet } from '../ChangeSet'
import { getNodeTrackedData } from '../compute/nodeHelpers'
import { CHANGE_STATUS } from '../types/change'
import { ExposedReplaceStep } from '../types/pm'
import { InsertSliceStep } from '../types/step'
import { NewEmptyAttrs, TrTrackingContext } from '../types/track'
import { log } from '../utils/logger'
import { mapChangeSteps } from '../utils/mapChangeStep'
import {
  filterMeaninglessMoveSteps,
  handleDirectPendingMoveDeletions,
  HasMoveOperations,
} from '../utils/track-utils'
import { uuidv4 } from '../utils/uuidv4'
import trackAttrsChange from './trackAttrsChange'
import {
  trackAddMarkStep,
  trackAddNodeMarkStep,
  trackRemoveMarkStep,
  trackRemoveNodeMarkStep,
} from './trackMarkSteps'
import { trackReplaceAroundStep } from './trackReplaceAroundStep'
import { trackReplaceStep } from './trackReplaceStep'
import { isStructureSteps } from './utils'
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
 *
 * The main function of track changes that holds the most complex parts of this whole library.
 * Takes in as arguments the data from appendTransaction to reapply it with the track marks/attributes.
 * We could prevent the initial transaction from being applied all together but since invert works just
 * as well and we can use the intermediate doc for checking which nodes are changed, it's not prevented.
 *
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
  authorID: string,
  changeSet: ChangeSet
) {
  const emptyAttrs: NewEmptyAttrs = {
    authorID,
    reviewedByID: null,
    createdAt: tr.time,
    updatedAt: tr.time,
    statusUpdateAt: 0, // has to be zero as first so changes are not differeniated at start
    status: CHANGE_STATUS.pending,
  }

  // Check for indentation metadata and treat it like a move operation
  const action = getAction(tr, TrackChangesAction.indentationAction)?.action
  const isIndentation = action === 'indent' || action === 'unindent'
  // Must use constructor.name instead of instanceof as aliasing prosemirror-state is a lot more
  // difficult than prosemirror-transform
  const wasNodeSelection = tr.selection instanceof NodeSelectionClass
  const setsNewSelection = tr.selectionSet
  // mapping for deleted content, that was inserted before
  const deletedNodeMapping = new Mapping()
  let iters = 0
  log.info('ORIGINAL transaction', tr)

  let trContext: TrTrackingContext = {}
  let movingStepsAssociated = HasMoveOperations(tr)

  if (isIndentation) {
    const moveId = uuidv4()
    // Assign the same moveId to all steps in the transaction
    tr.steps.forEach((step) => {
      if (step instanceof ReplaceStep) {
        movingStepsAssociated.set(step, moveId)
      }
    })
  }

  // First handle direct pending move deletions (not part of multiple moves)
  handleDirectPendingMoveDeletions(tr, newTr, movingStepsAssociated)

  const cleanSteps = filterMeaninglessMoveSteps(tr, movingStepsAssociated)

  for (let i = cleanSteps.length - 1; i >= 0; i--) {
    const step = cleanSteps[i]

    log.info('transaction step', step)
    iters += 1

    const uiEvent = tr.getMeta('uiEvent')
    const isMassReplace = tr.getMeta('massSearchReplace')
    if (iters > 20 && uiEvent != 'cut' && !isMassReplace) {
      console.error(
        '@manuscripts/track-changes-plugin: Possible infinite loop in iterating tr.steps, tracking skipped!\n' +
          'This is probably an error with the library, please report back to maintainers with a reproduction if possible',
        newTr
      )
      continue
    } else if (!(step instanceof ReplaceStep) && step.constructor.name === 'ReplaceStep') {
      console.error(
        '@manuscripts/track-changes-plugin: Multiple prosemirror-transform packages imported, alias/dedupe them ' +
          'or instanceof checks fail as well as creating new steps'
      )
      continue
    } else if (step instanceof ReplaceStep) {
      const { slice } = step as ExposedReplaceStep
      if (slice?.content?.content?.length === 1 && isHighlightMarkerNode(slice.content.content[0])) {
        // don't track highlight marker nodes
        continue
      }

      const invertedStep = step.invert(tr.docs[i])
      const isDelete = step.from !== step.to && step.slice.content.size < invertedStep.slice.content.size

      let thisStepMapping = tr.mapping.slice(i + 1, i + 1)
      if (isDelete || isStructureSteps(tr)) {
        thisStepMapping = deletedNodeMapping
      }
      /*
      In reference to "const thisStepMapping = tr.mapping.slice(i + 1)""
      Remember that every step in a transaction is applied on top of the previous step in that transaction.
      So here, during tracking processing, each step is intended for its own document but not for the final document - the tr.doc
      Because of that when a step is processed it has to be remapped to all the steps that occured after it or it will be mismatched as if there were no steps after it.
      This is apparent only in transactions with multiple insertions/deletions across the document and, withtout such mapping, if the last
      step adds content before the first step, the plugin will attempt to insert tracked replacement for the first change at a position
      that corresponds to the first change position if the second change (second in time but occuring earlier in doc) never occured.
      */
      // @TODO - check if needed to be done for other types of steps

      const newStep = new ReplaceStep(
        thisStepMapping.map(invertedStep.from),
        thisStepMapping.map(invertedStep.to),
        invertedStep.slice
      )
      const stepResult = newTr.maybeStep(newStep)

      let [steps, startPos] = trackReplaceStep(
        step,
        oldState,
        newTr,
        emptyAttrs,
        stepResult,
        tr.docs[i],
        tr,
        movingStepsAssociated.get(step)
      )

      if (steps.length === 1) {
        const step: any = steps[0] // eslint-disable-line @typescript-eslint/no-explicit-any
        if (isHighlightMarkerNode(step?.node || step?.slice?.content?.content[0])) {
          // don't track deleted highlight marker nodes
          continue
        }
      }

      startPos = thisStepMapping.map(startPos)
      steps = mapChangeSteps(steps, thisStepMapping)

      log.info('CHANGES: ', steps)
      // deleted and merged really...
      const deleted = steps.filter((s) => s.type !== 'insert-slice')
      const inserted = steps.filter((s) => s.type === 'insert-slice') as InsertSliceStep[]
      steps = diffChangeSteps(deleted, inserted)
      log.info('DIFFED STEPS: ', steps)

      // if step is in movingPairs, add its uuid (Map entry key) as moveNodeId
      const [mapping, selectionPos] = processChangeSteps(
        steps,
        startPos || tr.selection.head, // Incase startPos is it's default value 0, use the old selection head
        newTr,
        movingStepsAssociated.has(step)
          ? { ...emptyAttrs, moveNodeId: movingStepsAssociated.get(step) }
          : emptyAttrs,
        oldState.schema,
        deletedNodeMapping
      )
      if (!wasNodeSelection && !setsNewSelection) {
        const sel: typeof Selection = getSelectionStaticConstructor(tr.selection)
        // Use Selection.near to fix selections that point to a block node instead of inline content
        // eg when inserting a complete new paragraph. -1 finds the first valid position moving backwards
        // inside the content

        const near: Selection = sel.near(newTr.doc.resolve(selectionPos), -1)
        newTr.setSelection(near)
      }
    } else if (step instanceof ReplaceAroundStep) {
      let steps = trackReplaceAroundStep(step, oldState, tr, newTr, emptyAttrs, tr.docs[i], trContext)
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
        oldState.schema,
        deletedNodeMapping
      )
    } else if (step instanceof AttrStep) {
      const changeSteps = trackAttrsChange(step, oldState, tr, newTr, emptyAttrs, tr.docs[i])

      const [mapping, selectionPos] = processChangeSteps(
        changeSteps,
        tr.selection.from,
        newTr,
        emptyAttrs,
        oldState.schema,
        deletedNodeMapping
      )
    } else if (step instanceof AddMarkStep) {
      trackAddMarkStep(step, emptyAttrs, newTr, tr.docs[i])
      // adding a mark between text that has tracking_mark will split that text with tracking attributes that have the same id, so we update id to be unique
      const dataTracked = getNodeTrackedData(newTr.doc.nodeAt(step.from), oldState.schema)?.pop()
      if (dataTracked) {
        updateChangeAttrs(
          newTr,
          { id: dataTracked.id as string, from: step.from, to: step.to, type: 'text-change', dataTracked },
          { ...dataTracked, id: uuidv4() },
          oldState.schema
        )
      }
    } else if (step instanceof RemoveMarkStep) {
      trackRemoveMarkStep(step, emptyAttrs, newTr, tr.docs[i])
    }
    //else if (step instanceof RemoveNodeMarkStep) {
    //   trackRemoveNodeMarkStep(step, emptyAttrs, newTr, tr.docs[i])
    // } else if (step instanceof AddNodeMarkStep) {
    //   trackAddNodeMarkStep(step, emptyAttrs, newTr, tr.docs[i])
    // }
    // TODO: here we could check whether adjacent inserts & deletes cancel each other out.
    // However, this should not be done by diffing and only matching node or char by char instead since
    // it's A easier and B more intuitive to user.

    // The old meta keys are not copied to the new transaction since this will cause race-conditions
    // when a single meta-field is expected to having been processed / removed. Generic input meta keys,
    // inputType and uiEvent, are re-added since some plugins might depend on them and process the transaction
    // after track-changes plugin.
    tr.getMeta('inputType') && newTr.setMeta('inputType', tr.getMeta('inputType'))
    tr.getMeta('uiEvent') && newTr.setMeta('uiEvent', tr.getMeta('uiEvent'))
  }
  if (setsNewSelection && tr.selection instanceof TextSelection) {
    let from = tr.selection.from
    if (isStructureSteps(tr)) {
      // this mapping will capture invert mapping of delete steps as that what plugin do, also will map the actual
      // deleted nodes mapping in deleteNode.ts
      const selectionMapping = new Mapping()
      tr.steps.map((step) => {
        const isDeleteStep = step instanceof ReplaceStep && step.from !== step.to && step.slice.size === 0
        if (isDeleteStep) {
          selectionMapping.appendMap(step.getMap().invert())
        }
      })
      selectionMapping.appendMapping(deletedNodeMapping)
      from = selectionMapping.map(tr.selection.from)
    }
    // preserving text selection if we track an element in which selection is set
    const newPos = newTr.doc.resolve(from)
    newTr.setSelection(new TextSelection(newPos))
  }
  // This is kinda hacky solution at the moment to maintain NodeSelections over transactions
  // These are required by at least cross-references and links to activate their selector pop-ups
  if (wasNodeSelection) {
    log.info('Getting into node select!')
    // And -1 here is necessary to keep the selection pointing at the start of the node
    // (or something, breaks with cross-references otherwise)
    const mappedPos = newTr.mapping.map(tr.selection.from, -1)
    const sel: typeof NodeSelection = getSelectionStaticConstructor(tr.selection)
    newTr.setSelection(sel.create(newTr.doc, mappedPos))
  }
  log.info('NEW transaction', newTr)
  return newTr
}
