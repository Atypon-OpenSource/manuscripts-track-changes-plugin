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
import { Fragment, Node as PMNode, Slice } from 'prosemirror-model'
import { Selection, TextSelection, Transaction } from 'prosemirror-state'
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform'

import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from '../types/change'
import { ChangeStep } from '../types/step'
import {
  NewDeleteAttrs,
  NewEmptyAttrs,
  NewInsertAttrs,
  NewReferenceAttrs,
  NewSplitNodeAttrs,
  NewUpdateAttrs,
} from '../types/track'

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
    lastChild!.inlineContent
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

export const isNodeMoveOperation = (tr: Transaction): boolean => {
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

  // Quick pre-check: Need at least 2 steps (delete + insert) to be a move
  if (tr.steps.length < 2) {
    return false
  }

  // All steps must be ReplaceSteps
  if (!tr.steps.every((step) => step instanceof ReplaceStep)) {
    return false
  }

  // Track content hashes of deleted and inserted nodes
  const deletedHashes = new Set<string>()
  const insertedHashes = new Set<string>()

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i] as ReplaceStep
    const doc = tr.docs[i]
    const content = step.slice.size === 0 ? doc.slice(step.from, step.to) : step.slice

    if (step.from !== step.to && step.slice.size === 0) {
      // Delete operation - add content hash
      if (content.content.firstChild) {
        deletedHashes.add(content.content.firstChild.toString())
      }
    } else if (step.slice.size > 0) {
      // Insert operation - add content hash
      if (content.content.firstChild) {
        insertedHashes.add(content.content.firstChild.toString())
      }
    }
  }

  /**
   * Content matching verification:
   *
   * This is a critical check that ensures we only identify true move operations
   * where the exact same content is being moved (not modified).
   *
   * The logic:
   * 1. First compare hash counts - if different, definitely not a move
   * 2. Then verify every inserted node matches a deleted node
   *
   * This is an efficient way to confirm the transaction is moving nodes
   * without actually modifying their content.
   */
  if (deletedHashes.size !== insertedHashes.size) {
    return false
  }

  for (const hash of insertedHashes) {
    if (!deletedHashes.has(hash)) {
      return false
    }
  }

  return true
}

/**
 * Detects if we're deleting a pending moved node
 */
export const isDeletingPendingMovedNode = (step: ReplaceStep, doc: PMNode): boolean => {
  if (step.from === step.to || step.slice.content.size > 0) {
    return false
  }

  const node = doc.nodeAt(step.from)
  return !!node?.attrs.dataTracked?.find(
    (tracked: TrackedAttrs) =>
      tracked.operation === CHANGE_OPERATION.move && tracked.status === CHANGE_STATUS.pending
  )
}
