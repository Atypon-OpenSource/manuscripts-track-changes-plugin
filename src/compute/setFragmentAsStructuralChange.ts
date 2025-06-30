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
import { Fragment, Node as PMNode, Slice } from 'prosemirror-model'
import { EditorState, Selection, Transaction } from 'prosemirror-state'
import { ReplaceStep } from 'prosemirror-transform'

import { findChanges } from '../changes/findChanges'
import { CHANGE_OPERATION, StructureAttrs } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import * as trackUtils from '../utils/track-utils'
import { updateBlockNodesAttrs } from '../utils/track-utils'
import { uuidv4 } from '../utils/uuidv4'
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData } from './nodeHelpers'
import { setFragmentAsInserted } from './setFragmentAsInserted'

/**
 * return dataTracked if we are reapplying same structural action, like converting: section -> paragraph -> section
 */
const getDataTrackedIfSameActionApplied = (
  selection: Selection,
  doc: PMNode
): Partial<StructureAttrs> | undefined => {
  const { $from } = selection
  let node = $from.node()
  if (node.type === node.type.schema.nodes.section_title) {
    node = $from.node($from.depth - 1)
  }

  const dataTracked = (getBlockInlineTrackedData(node) || []).find(
    (c) => c.operation === CHANGE_OPERATION.structure
  ) as Partial<StructureAttrs>
  if (!dataTracked) {
    return undefined
  }

  if (dataTracked.action === 'convert-section' && node.type === node.type.schema.nodes.section) {
    return dataTracked
  }

  if (dataTracked.action === 'convert-paragraph' && node.type === node.type.schema.nodes.paragraph) {
    // this to make sure we are reapplying same action from the starting node of that change
    // so if we convert section to paragraph then section_title that converted to paragraph will be our target
    const pos = $from.before($from.depth)
    const nodeBefore = doc.resolve(pos).nodeBefore
    if (!nodeBefore) {
      return dataTracked
    } else if (nodeBefore) {
      const startPointChange = (getBlockInlineTrackedData(nodeBefore) || []).find(
        (c) => c.operation === 'structure' && c.moveNodeId === dataTracked.moveNodeId
      )
      if (!startPointChange) {
        return dataTracked
      }
    }
  }
}

const cleanUpDataTracked = (
  step: ReplaceStep,
  sameActionDataTracked: Partial<StructureAttrs>,
  oldState: EditorState,
  newTr: Transaction
) => {
  let content = step.slice.content

  const mainSection = step.slice.content.firstChild
  const supSection = step.slice.content.lastChild
  let supSectionTitle = supSection?.firstChild
  // sink second section in the first one as change is a supSubsection
  if (sameActionDataTracked.isSupSection && mainSection && supSection && supSectionTitle) {
    const dataTracked = getBlockInlineTrackedData(supSectionTitle) || []
    // this will move back convert-paragraph changes in children that was originally in the supSection,
    // case of that converting parent of supSection to paragraph then converting that supSection to paragraph and section
    supSectionTitle =
      supSectionTitle.type.create(
        {
          ...supSectionTitle.attrs,
          dataTracked: dataTracked.filter((c) => c.operation !== CHANGE_OPERATION.structure),
        },
        supSectionTitle.content
      ) || supSectionTitle
    const changesSet = new Set((getBlockInlineTrackedData(supSectionTitle) || []).map((c) => c.id))
    content = Fragment.from(
      mainSection.copy(
        mainSection.content.append(
          Fragment.from(
            supSection.type.create(
              {
                ...supSection?.attrs,
                dataTracked: dataTracked.filter(
                  (c) => c.moveNodeId !== sameActionDataTracked.moveNodeId && !changesSet.has(c.id)
                ),
              },
              Fragment.from(supSectionTitle).append(supSection.slice(supSectionTitle.nodeSize).content)
            )
          )
        )
      )
    )
  }

  const changes = findChanges(oldState).changes.filter(
    (c) =>
      c.dataTracked.moveNodeId === sameActionDataTracked.moveNodeId ||
      (c.dataTracked.operation === CHANGE_OPERATION.reference &&
        c.dataTracked.referenceId === sameActionDataTracked.moveNodeId)
  )
  changes.map((change) => {
    const node = newTr.doc.nodeAt(change.from)
    if (node) {
      const dataTracked = (getBlockInlineTrackedData(node) || []).filter((c) => c.id !== change.id)
      newTr.setNodeMarkup(change.from, undefined, { ...node.attrs, dataTracked })
    }
  })

  // that will clean up dataTracked for step slice
  return updateBlockNodesAttrs(content, (attrs, node) => {
    const dataTracked = getBlockInlineTrackedData(node) || []
    if (!dataTracked) {
      return attrs
    }
    return {
      ...attrs,
      dataTracked: dataTracked.filter(
        (c) =>
          c.moveNodeId !== sameActionDataTracked.moveNodeId ||
          (c.operation === CHANGE_OPERATION.reference && c.referenceId === sameActionDataTracked.moveNodeId)
      ),
    }
  })
}

/**
 *  ## This function cover case of:
 *  - convert Section to Paragraph: that will be tracked by adding structure change to the section children and
 *    moveNodeId will be used to realize that they are related to convert change.
 *  - convert Paragraph to Section: new section will have structure change and will add reference_change to the
 *    adjacent node for the converted paragraph, so we can use to return content back on rejection.
 *
 *  -- As we send one step for structural change, will use `findDiffStart` to know starting point for the effected change
 *  and where we are going to add reference change when we convert paragraph to section.
 *  <br />
 *  -- This function also check if we are reapplying same action on a tracked structural change to clean change, so we
 *  can avoid the complexity of reverting changes as loop. like this: section -> paragraph -> section -> paragraph
 */
export function setFragmentAsStructuralChange(
  step: ReplaceStep,
  oldState: EditorState,
  newTr: Transaction,
  tr: Transaction,
  attrs: NewEmptyAttrs
) {
  const sameActionDataTracked = getDataTrackedIfSameActionApplied(oldState.selection, oldState.doc)
  if (sameActionDataTracked) {
    return cleanUpDataTracked(step, sameActionDataTracked, oldState, newTr)
  }

  // that ID will be used:
  // - converting section -> paragraph, to group converted section children
  // - converting paragraph -> section, will be the connection between the node before paragraph to the new section as reference-change
  const moveNodeId = uuidv4()
  const action = tr.getMeta('action')
  const sectionLevel = tr.getMeta('section-level')
  let isThereSectionBefore = false
  let isSupSection = false
  const content = step.slice.content
  const replaceContent = newTr.doc.slice(step.from, step.to).content
  const differentPos = replaceContent.findDiffStart(content) || step.slice.content.size
  let wrapper = newTr.doc.type.schema.nodes.body.create(undefined, content)

  if (content.firstChild && content.firstChild.type === newTr.doc.type.schema.nodes.section_title) {
    wrapper = newTr.doc.type.schema.nodes.section.create(undefined, content)
  }

  // That for first child in body, we don't use reference as tracking scope will be just for inner body
  if (tr.getMeta('track-without-reference')) {
    const updatedContent: PMNode[] = []
    wrapper.content.forEach((node) => {
      const dataTracked = getBlockInlineTrackedData(node) || []
      updatedContent.push(
        node.type.create(
          {
            ...node.attrs,
            dataTracked: [
              addTrackIdIfDoesntExist(trackUtils.createNewStructureAttrs({ ...attrs, moveNodeId }, action)),
              ...dataTracked,
            ],
          },
          node.content
        )
      )
    })
    return Fragment.from(updatedContent)
  }

  // add reference change to the adjacent node to the converted paragraph
  // that will be used to return content after the reference on rejection
  if (action === 'convert-section') {
    wrapper.nodesBetween(0, differentPos, (node, pos) => {
      if (pos + node.nodeSize === differentPos) {
        const dataTracked = getBlockInlineTrackedData(node) || []
        wrapper = wrapper.replace(
          pos,
          pos + node.nodeSize,
          new Slice(
            Fragment.from(
              node.type.create(
                Object.assign(Object.assign({}, node.attrs), {
                  dataTracked: [
                    addTrackIdIfDoesntExist(trackUtils.createNewReferenceAttrs(attrs, moveNodeId, true)),
                    ...dataTracked,
                  ],
                }),
                node.content
              )
            ),
            0,
            0
          )
        )

        return false
      }
    })
  }

  wrapper.nodesBetween(differentPos, step.slice.content.size, (node, pos) => {
    if (pos < differentPos) {
      return
    }

    let content = node.content

    // this will set added empty paragraph to a section as insert node change
    if (
      node.type === node.type.schema.nodes.section &&
      node.childCount === 2 &&
      node.lastChild?.content.size === 0
    ) {
      const paragraph = setFragmentAsInserted(
        Fragment.from(node.lastChild),
        trackUtils.createNewInsertAttrs(attrs),
        newTr.doc.type.schema
      ).firstChild
      if (paragraph) {
        content = content.replaceChild(1, paragraph)
      }
    }

    if (action === 'convert-paragraph') {
      const $from = oldState.selection.$from
      const sectionPos = $from.start($from.depth - 2)
      if (oldState.doc.resolve(sectionPos).parent.type !== oldState.schema.nodes.body) {
        isSupSection = true
      }
      oldState.doc.slice(sectionPos, $from.before($from.depth - 1)).content.forEach((node) => {
        if (node.type === oldState.schema.nodes.section) {
          isThereSectionBefore = true
        }
      })
    }

    const dataTracked = getBlockInlineTrackedData(node) || []
    wrapper = wrapper.replace(
      pos,
      pos + node.nodeSize,
      new Slice(
        Fragment.from(
          node.type.create(
            {
              ...node.attrs,
              dataTracked: [
                addTrackIdIfDoesntExist(
                  trackUtils.createNewStructureAttrs(
                    { ...attrs, moveNodeId },
                    action,
                    sectionLevel,
                    isThereSectionBefore,
                    isSupSection
                  )
                ),
                ...dataTracked,
              ],
            },
            content
          )
        ),
        0,
        0
      )
    )
    return false
  })

  return Fragment.from(wrapper.content)
}
