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
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform'

import { ChangeSet } from '../../ChangeSet'
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from '../../types/change'

export const isDeleteStep = (step: ReplaceStep) =>
  step.from !== step.to && step.slice.content.size < step.to - step.from

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

  if (
    uiEvent === 'paste' &&
    slice.content.firstChild?.inlineContent &&
    slice.content.lastChild?.inlineContent
  ) {
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

/** Qualifies as a lift step when:
    - there is a retained gap (captured original content that we insert)
    - step.from < gapFrom  - meaning we remove content in front of the gap
    - step.to > gapTo     - meaning we remove content after the gap
    - nothing new is inserted: slice is empty
  */
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
}

/**
    The step is a lift from an end of the step range.
    In other words it means that we removed a piece of content from the end of the step range,
    we then retained it and we put it at the start of the step range, e.g:
    -> <p>
    |  <ul>
    |   <li>
    ----- <p>
            <p>
  */
export function isLiftStepForGap(
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
