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
import { Node as PMNode } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'
import { ReplaceStep, Step } from 'prosemirror-transform'

import { isIndentationAction, TrackChangesAction } from '../actions'
import { ChangeSet } from '../ChangeSet'
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from '../types/change'
import { uuidv4 } from '../utils/uuidv4'
import { isDeletingPendingMovedNode, isDirectPendingMoveDeletion } from './steps-trackers/qualifiers'
import { TrTrackingContext } from './types'

export function getIndentationOperationSteps(tr: Transaction, trContext: TrTrackingContext) {
  if (isIndentationAction(trContext.action)) {
    // Assign the same moveId to all steps in the transaction if it's an indentation or an unindentation
    const moveId = uuidv4()
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i]
      if (step instanceof ReplaceStep) {
        trContext.stepsByGroupIDMap.set(step, moveId)
      }
    }
  }
}

export const excludeFromTracking = (node: PMNode) => {
  if (node.isText) {
    return false
  }
  return node && !node.type.spec.attrs?.dataTracked // currently only highlight marker, @TODO - verify highlight marker functionality and add it to schema in highlight marker
}

export function passThroughMeta(oldTr: Transaction, newTr: Transaction) {
  /* The old meta keys are not copied to the new transaction since this will cause race-conditions
   when a single meta-field is expected to having been processed / removed. Generic input meta keys,
   inputType and uiEvent are re-added since some plugins might depend on them and process the transaction
   after track-changes plugin. */
  oldTr.getMeta('inputType') && newTr.setMeta('inputType', oldTr.getMeta('inputType'))
  oldTr.getMeta('uiEvent') && newTr.setMeta('uiEvent', oldTr.getMeta('uiEvent'))
  return newTr
}

export function iterationIsValid(iterations: number, oldTr: Transaction, newTr: Transaction, step: Step) {
  const uiEvent = oldTr.getMeta('uiEvent')
  const isMassReplace = oldTr.getMeta('massSearchReplace')
  if (iterations > 20 && uiEvent != 'cut' && !isMassReplace) {
    console.error(
      '@manuscripts/track-changes-plugin: Possible infinite loop in iterating tr.steps, tracking skipped!\n' +
        'This is probably an error with the library, please report back to maintainers with a reproduction if possible',
      newTr
    )
    return false
  } else if (!(step instanceof ReplaceStep) && step.constructor.name === 'ReplaceStep') {
    console.error(
      '@manuscripts/track-changes-plugin: Multiple prosemirror-transform packages imported, alias/dedupe them ' +
        'or instanceof checks fail as well as creating new steps'
    )
    return false
  }
  return true
}

export const getMoveOperationsSteps = (tr: Transaction, context: TrTrackingContext) => {
  /**
   * Determines if a transaction represents a node move operation (like drag-and-drop) and
   * returns a map of steps with created id of change to which that step pertains.
   *
   * Our approach to detecting moves involves:
   * 1. Checking basic preconditions (multiple steps, all ReplaceSteps)
   * 2. Comparing content hashes of deleted and inserted nodes
   *
   * A move operation must meet these criteria:
   * - Contains at least 2 steps (delete + insert)
   * - All steps are ReplaceSteps
   * - The exact same content is being deleted and inserted elsewhere
   */

  const movingAssoc = context.stepsByGroupIDMap

  // Quick pre-check: Need at least 2 steps (delete + insert) to be a move
  if (tr.steps.length < 2) {
    return movingAssoc
  }

  if (tr.getMeta(TrackChangesAction.structuralChangeAction)) {
    const commonID = uuidv4()
    movingAssoc.set(tr.steps[0] as ReplaceStep, commonID)
    movingAssoc.set(tr.steps[1] as ReplaceStep, commonID)
    return movingAssoc
  }

  const matched: number[] = []

  for (let i = 0; i < tr.steps.length; i++) {
    // skipping if already paired
    if (matched.includes(i)) {
      continue
    }
    const step = tr.steps[i] as ReplaceStep
    const doc = tr.docs[i]

    // skipping step without slice
    // there is nothing to insert or delete
    if (!step.slice) {
      continue
    }
    const stepDeletesContent = step.from !== step.to && step.slice.size === 0
    const stepInsertsContent = step.slice.size && step.slice.content.firstChild ? true : false

    for (let g = 0; g < tr.steps.length; g++) {
      // skipping if it's the same step or already paired
      if (g === i || matched.includes(g)) {
        continue
      }
      const peerStep = tr.steps[g] as ReplaceStep

      // skipping step without slice
      // there is nothing to insert or delete
      if (!peerStep.slice) {
        continue
      }
      const peerStepInsertsContent = peerStep.slice.size && peerStep.slice.content.firstChild
      const peerStepDeletesContent = peerStep.from !== peerStep.to && peerStep.slice.size === 0

      if (stepDeletesContent) {
        const deletedContent = doc.slice(step.from, step.to)

        if (
          peerStepInsertsContent &&
          deletedContent.content.firstChild &&
          peerStep.slice.content.firstChild.toString() === deletedContent.content.firstChild.toString()
        ) {
          const commonID = uuidv4()
          movingAssoc.set(peerStep, commonID)
          movingAssoc.set(step, commonID)
          matched.push(i, g)
        }
        continue
        // Delete operation detected
        // find a pair for it among inserting steps
      }

      if (stepInsertsContent && peerStepDeletesContent) {
        const insertedContent = step.slice
        const deletedPeerContent = tr.docs[g].slice(peerStep.from, peerStep.to)
        if (
          insertedContent.content.firstChild &&
          deletedPeerContent.content.firstChild &&
          insertedContent.content.firstChild.toString() === deletedPeerContent.content.firstChild.toString()
        ) {
          const commonID = uuidv4()
          movingAssoc.set(peerStep, commonID)
          movingAssoc.set(step, commonID)
        }
        matched.push(i, g)
        // Insert operation detected
        // find a pair for it among deleting steps
      }
    }
  }
  // return movingAssoc
}

/**
 * Cleaning up deleted moves based on ref map in the context (not part of moving pending moved node).
 * Having some pending moved content (a node was moved and there is a shadow of it on its former position), when
 * a parent of that shadow is removed, we requalify the "MOVE" operation into an insertion using this function.
 * Shadow - is a lingo for a hidden node that exists to track back a pending change that caused this node to be hidden (move or indent, but not deletion - deletions are visible)
 */
export const changeMovedToInsertsOnSourceDeletion = (
  tr: Transaction,
  newTr: Transaction,
  trContext: TrTrackingContext
) => {
  /* @TODO: we have orphanRemove...something-something function that does pretty much the same thing */
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i]
    if (step instanceof ReplaceStep) {
      const doc = tr.docs[tr.steps.indexOf(step)]
      if (isDirectPendingMoveDeletion(step, doc, trContext.stepsByGroupIDMap)) {
        const node = doc.nodeAt(step.from)
        if (node?.attrs.dataTracked) {
          // Remove the pending move tracking record
          newTr.setNodeMarkup(step.from, undefined, {
            ...node.attrs,
            dataTracked: node.attrs.dataTracked.filter(
              (t: TrackedAttrs) =>
                !(t.operation === CHANGE_OPERATION.move && t.status === CHANGE_STATUS.pending)
            ),
          })
        }
      }
    }
  }
}

/**
 * Filters out meaningless move steps from a transaction's steps array.
 *
 * A meaningless move step is one that moves a node that was previously moved
 * and is under pending move change. In this case we want to:
 * 1. Skip tracking the deletion
 * 2. Associate the original deletion with the new move
 *
 * Also filters out move operations where the inserted node has pending insert tracking
 * and no move operations, to keep them as insert suggestions.
 *
 * @param tr The original transaction
 * @param movingSteps Map of move operations in the transaction
 * @returns Filtered array of steps with meaningless moves removed
 */
export const filterMeaninglessMoveSteps = (tr: Transaction, context: TrTrackingContext) => {
  const cleanSteps: Array<Step | null> = []

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i]
    // if this steps again moves a node that was previously moved and is under pending move change, then dont track that deletion
    // and associate original deletion with the new move
    const moveID = context.stepsByGroupIDMap.get(step as ReplaceStep)

    if (moveID) {
      // Check if this step moves a node that was previously moved and is under pending move change
      const prevMoveID = isDeletingPendingMovedNode(step as ReplaceStep, tr.docs[i])
      if (prevMoveID) {
        // find the peer step for the ignored step and change its key to previous moveNodeID
        context.stepsByGroupIDMap.forEach((replaceStepMoveID, replaceStep) => {
          if (replaceStep !== step && moveID === replaceStepMoveID) {
            // get previous moveID
            context.stepsByGroupIDMap.set(replaceStep, prevMoveID)
          }
        })
        cleanSteps.push(null)
        continue
      }

      // Check if this step inserts a node with pending insert tracking and no move operations
      // skip will ruin complex tr steps mapping on invert, so will ignore it for node convert
      if (step instanceof ReplaceStep && !tr.getMeta(TrackChangesAction.structuralChangeAction)) {
        const { slice } = step
        if (slice?.content?.firstChild) {
          const insertedNode = slice.content.firstChild
          if (insertedNode.attrs.dataTracked) {
            const isPendingInsert = ChangeSet.isPendingChange(
              insertedNode.attrs.dataTracked as TrackedAttrs[],
              CHANGE_OPERATION.insert
            )
            // If the node has pending insert tracking and no move operations, skip this step
            if (isPendingInsert) {
              continue
            }
          }
        }
      }
    }

    cleanSteps.push(step)
  }
  return cleanSteps
}

// @ts-ignore
export const trFromHistory = (tr: Transaction) => Object.keys(tr.meta).find((s) => s.startsWith('history$'))
