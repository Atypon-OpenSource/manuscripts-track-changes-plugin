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
import { Node as PMNode, Slice } from 'prosemirror-model'
import { Selection, Transaction } from 'prosemirror-state'
import { ReplaceAroundStep, ReplaceStep, Step } from 'prosemirror-transform'

import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from '../types/change'
import {
  NewDeleteAttrs,
  NewEmptyAttrs,
  NewInsertAttrs,
  NewReferenceAttrs,
  NewSplitNodeAttrs,
  NewUpdateAttrs,
} from '../types/track'
import { uuidv4 } from './uuidv4'

export function createNewInsertAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.insert,
  }
}

export function createNewWrapAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.wrap_with_node,
  }
}

export function createNewSplitAttrs(attrs: NewEmptyAttrs): NewSplitNodeAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.node_split,
  }
}

export function createNewReferenceAttrs(attrs: NewEmptyAttrs, id: string): NewReferenceAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.reference,
    referenceId: id,
  }
}

export function createNewDeleteAttrs(attrs: NewEmptyAttrs): NewDeleteAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.delete,
  }
}

export function createNewMoveAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.move,
  }
}

export function createNewUpdateAttrs(attrs: NewEmptyAttrs, oldAttrs: Record<string, any>): NewUpdateAttrs {
  // Omit dataTracked
  const { dataTracked, ...restAttrs } = oldAttrs
  return {
    ...attrs,
    operation: CHANGE_OPERATION.set_node_attributes,
    oldAttrs: JSON.parse(JSON.stringify(restAttrs)),
  }
}

export const isSplitStep = (step: ReplaceStep, selection: Selection, uiEvent: string) => {
  const { from, to, slice } = step

  if (
    from !== to ||
    slice.content.childCount < 2 ||
    (slice.content.firstChild?.isInline && slice.content.lastChild?.isInline)
  ) {
    return false
  }

  const {
    $anchor: { parentOffset: startOffset },
    $head: { parentOffset: endOffset },
    $from,
  } = selection
  const parentSize = $from.node().content.size

  if (uiEvent === 'paste') {
    // paste of content on the side of selection will not be considered as node split
    return !(
      (startOffset === 0 && endOffset === 0) ||
      (startOffset === parentSize && endOffset === parentSize)
    )
  }

  const {
    content: { firstChild, lastChild },
    openStart,
    openEnd,
  } = slice

  if (
    // @ts-ignore
    (window.event?.code === 'Enter' || window.event?.code === 'NumpadEnter') &&
    firstChild?.type.name === 'list_item'
  ) {
    return !(parentSize === startOffset && parentSize === endOffset) && lastChild?.type.name === 'list_item'
  }

  return (
    openStart === openEnd &&
    firstChild!.type === lastChild!.type &&
    firstChild!.inlineContent &&
    lastChild!.inlineContent &&
    !(startOffset === parentSize && endOffset === parentSize)
  )
}

export const isWrapStep = (step: ReplaceAroundStep) =>
  step.from === step.gapFrom &&
  step.to === step.gapTo &&
  step.slice.openStart === 0 &&
  step.slice.openEnd === 0

export const isLiftStep = (step: ReplaceAroundStep) => {
  if (
    step.from < step.gapFrom &&
    step.to > step.gapTo &&
    step.slice.size === 0 &&
    step.gapTo - step.gapFrom > 0
  ) {
    return true
  }
  return false
  /* qualifies as a lift step when:
    - there is a retained gap (captured original content that we insert)
    - step.from < gapFrom  - meaning we remove content in front of the gap
    - step.to > gapTo     - meaning we remove content after the gap
    - nothing new is inserted: slice is empty
  */
}

export function stepIsLift(
  /*
    The step is a lift from an end of the step range.
    In other words it means that we removed a piece of content from the end of the step range,
    we then retained it and we put it at the start of the step range, e.g:
      -> <p>
      |  <ul>
      |   <li>
      ----- <p>
              <p>
  */
  gap: {
    start: number
    end: number
    slice: Slice
    insert: number
  },
  node: PMNode,
  to: number
) {
  return gap.start < gap.end && gap.insert === 0 && gap.end === to && !node.isText
}

// @ts-ignore
export const trFromHistory = (tr: Transaction) => Object.keys(tr.meta).find((s) => s.startsWith('history$'))

export const HasMoveOperations = (tr: Transaction) => {
  /**
   * Determines if a transaction represents a node move operation (like drag-and-drop).
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

  type InsertStep = ReplaceStep
  type DeletStep = ReplaceStep
  const movingAssoc = new Map<ReplaceStep, string>()

  // Quick pre-check: Need at least 2 steps (delete + insert) to be a move
  if (tr.steps.length < 2) {
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

  return movingAssoc
}

/**
 * Checks if the given `TrackedAttrs` array contains a pending change of the specified operation type.
 */
export const isPendingChange = (
  trackedAttrs: TrackedAttrs[] | undefined,
  operation: CHANGE_OPERATION
): boolean => {
  return !!trackedAttrs?.some((t) => t.operation === operation)
}

/**
 * Detects if we're deleting a pending moved node
 */
export const isDeletingPendingMovedNode = (step: ReplaceStep, doc: PMNode) => {
  if (!step.slice || step.from === step.to || step.slice.content.size > 0) {
    return undefined
  }

  const node = doc.nodeAt(step.from)
  if (!node) {
    return undefined
  }
  const trackedAttrs = node.attrs.dataTracked as TrackedAttrs[]
  const found = trackedAttrs?.find(
    (tracked) => tracked.operation === CHANGE_OPERATION.move && tracked.status === CHANGE_STATUS.pending
  )
  if (found?.moveNodeId) {
    return found.moveNodeId
  }
  return undefined
}

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

  return isPendingChange(node.attrs.dataTracked as TrackedAttrs[] | undefined, CHANGE_OPERATION.move)
}

/**
 * Handles direct pending move deletions (not part of moving pending moved node)
 */
export const handleDirectPendingMoveDeletions = (
  tr: Transaction,
  newTr: Transaction,
  movingSteps: Map<ReplaceStep, string>
) => {
  tr.steps.forEach((step) => {
    if (step instanceof ReplaceStep) {
      const doc = tr.docs[tr.steps.indexOf(step)]
      if (isDirectPendingMoveDeletion(step, doc, movingSteps)) {
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
  })
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
export const filterMeaninglessMoveSteps = (
  tr: Transaction,
  movingSteps: Map<ReplaceStep, string>
): Step[] => {
  const cleanSteps: Step[] = []

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i]
    // if this steps again moves a node that was previously moved and is under pending move change, then dont track that deletion
    // and associate original deletion with the new move
    const moveID = movingSteps.get(step as ReplaceStep)

    if (moveID) {
      // Check if this step moves a node that was previously moved and is under pending move change
      const prevMoveID = isDeletingPendingMovedNode(step as ReplaceStep, tr.docs[i])
      if (prevMoveID) {
        // find the peer step for the ignored step and change its key to previous moveNodeID
        movingSteps.forEach((replaceStepMoveID, replaceStep) => {
          if (replaceStep !== step && moveID === replaceStepMoveID) {
            // get previous moveID
            movingSteps.set(replaceStep, prevMoveID)
          }
        })
        continue
      }

      // Check if this step inserts a node with pending insert tracking and no move operations
      if (step instanceof ReplaceStep) {
        const { slice } = step
        if (slice?.content?.firstChild) {
          const insertedNode = slice.content.firstChild
          if (insertedNode.attrs.dataTracked) {
            const isPendingInsert = isPendingChange(
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
