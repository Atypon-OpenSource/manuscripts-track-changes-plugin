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
import { Fragment } from 'prosemirror-model'
import { Selection, TextSelection } from 'prosemirror-state'
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform'

import { CHANGE_OPERATION } from '../types/change'
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

export function createNewSplitSourceAttrs(attrs: NewEmptyAttrs, id: string): NewReferenceAttrs {
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
