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
import { EditorState, Transaction } from 'prosemirror-state'
import { ReplaceStep } from 'prosemirror-transform'

import { findChanges } from '../changes/findChanges'
import { getUpdatedChangesContent } from '../changes/revertChange'
import { CHANGE_OPERATION, StructureAttrs, TrackedAttrs } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import * as trackUtils from '../utils/track-utils'
import { updateBlockNodesAttrs } from '../utils/track-utils'
import { uuidv4 } from '../utils/uuidv4'
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData } from './nodeHelpers'

/**
 * find target node we start from the convert process
 */
const getConvertedNode = (docContent: Fragment, stepContent: Fragment) => {
  const start = stepContent.findDiffStart(docContent) || 0
  const end = stepContent.findDiffEnd(docContent)?.b || docContent.size

  let target: PMNode | undefined

  docContent.nodesBetween(start, end, (node, pos, _, index) => {
    if (pos < start || target) {
      return
    }

    if (start === pos || (start > 0 && index === 1)) {
      target = node
      return false
    }
  })

  return target as PMNode
}

/**
 * get dataTracked of the converted nodes to not lose track of the previous changes on the converted node.
 *
 * --For node convert from Paragraph -> Section
 *   - new section will have a new change of insert/delete if paragraph already have, and mirror structure changes
 *   - section_title will mirror paragraph changes of (insert/delete/reference)
 *
 * --For node convert from Section -> Paragraph
 *   - new paragraph will mirror section_title (insert/delete/reference), and will mirror from section just structure changes
 */
export const getDataTrackedOfConvertedNode = (node: PMNode | undefined) => {
  const latest = (c1: Partial<TrackedAttrs>, c2: Partial<TrackedAttrs>) =>
    (c2.updatedAt || 0) - (c1.updatedAt || 0)
  let dataTracked: Partial<TrackedAttrs>[] = [],
    secDataTracked: Partial<TrackedAttrs>[] = []

  if (node) {
    dataTracked = getBlockInlineTrackedData(node) || []

    if (node.type === node.type.schema.nodes.section) {
      const secTitleDataTracked = (
        (node.firstChild && getBlockInlineTrackedData(node.firstChild)) ||
        []
      ).filter(
        (c) =>
          c.operation === CHANGE_OPERATION.delete ||
          c.operation === CHANGE_OPERATION.insert ||
          c.operation === CHANGE_OPERATION.reference
      )
      const secDataTracked = dataTracked.filter((c) => c.operation === CHANGE_OPERATION.structure)

      dataTracked = [...secTitleDataTracked, ...secDataTracked]
    } else {
      const InsertDelete = dataTracked.find(
        (c) => c.operation === CHANGE_OPERATION.delete || c.operation === CHANGE_OPERATION.insert
      )
      secDataTracked = dataTracked.filter((c) => c.operation === CHANGE_OPERATION.structure)
      dataTracked = dataTracked.filter((c) => c.operation === CHANGE_OPERATION.reference)
      if (InsertDelete) {
        dataTracked.push(InsertDelete)
        secDataTracked.push(
          addTrackIdIfDoesntExist({
            ...InsertDelete,
            id: uuidv4(),
          })
        )
      }
    }
    dataTracked = dataTracked.sort(latest)
    secDataTracked = secDataTracked.sort(latest)
  }

  return { dataTracked, secDataTracked }
}

const getDataTrackedIfSameActionApplied = (doc: PMNode, node: PMNode) => {
  const dataTracked = (getBlockInlineTrackedData(node) || []).find(
    (c) => c.operation === CHANGE_OPERATION.structure
  ) as Partial<StructureAttrs>
  if (!dataTracked) {
    return undefined
  }

  if (dataTracked.action === 'convert-to-section' && node.type === node.type.schema.nodes.section) {
    return dataTracked
  }

  if (dataTracked.action === 'convert-to-paragraph') {
    // this to make sure we are reapplying same action from the starting node of that change
    // so if we convert section to paragraph then section_title that converted to paragraph will be our target
    const changes = getUpdatedChangesContent(doc, (c) => c.moveNodeId === dataTracked.moveNodeId)
    const isItFirstNodeInChange = changes.find(
      (node, index) => node.attrs.dataTracked[0].id === dataTracked.id && index === 0
    )
    return isItFirstNodeInChange && dataTracked
  }
}

const cleanUpDataTracked = (
  content: Fragment,
  sameActionDataTracked: Partial<StructureAttrs>,
  dataTracked: Partial<TrackedAttrs>[],
  secDataTracked: Partial<TrackedAttrs>[],
  oldState: EditorState,
  newTr: Transaction
) => {
  const mainSection = content.firstChild
  let supSection = content.lastChild
  let supSectionTitle = supSection?.firstChild
  // sink second section in the first one as change is a supSubsection
  if (sameActionDataTracked.isSupSection && mainSection && supSection && supSectionTitle) {
    supSectionTitle = supSectionTitle.type.create(
      { ...supSectionTitle.attrs, dataTracked },
      supSectionTitle.content
    )
    supSection = supSection.type.create(
      { ...supSection.attrs, dataTracked: secDataTracked },
      Fragment.from(supSectionTitle).append(supSection.slice(supSectionTitle.nodeSize).content)
    )
    content = Fragment.from(mainSection.copy(mainSection.content.append(Fragment.from(supSection))))
  }

  const changes = findChanges(oldState.doc).changes.filter(
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
          !(
            c.moveNodeId === sameActionDataTracked.moveNodeId ||
            (c.operation === CHANGE_OPERATION.reference && c.referenceId === sameActionDataTracked.moveNodeId)
          )
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
  const schema = oldState.schema
  const {
    slice: { content: stepContent },
  } = step
  const replaceContent = newTr.doc.slice(step.from, step.to).content
  const node = getConvertedNode(replaceContent, stepContent)
  const sameActionDataTracked = getDataTrackedIfSameActionApplied(newTr.doc, node)
  let { dataTracked, secDataTracked } = getDataTrackedOfConvertedNode(node)

  // that ID will be used:
  // - converting section -> paragraph, to group converted section children
  // - converting paragraph -> section, will be the connection between the node before paragraph to the new section as reference-change
  const moveNodeId = uuidv4()
  const sectionLevel = tr.getMeta('section-level')
  const action = tr.getMeta('action') as StructureAttrs['action']
  let isThereSectionBefore = false
  let isSupSection = false
  const differentPos = replaceContent.findDiffStart(stepContent) || 0
  let wrapper = newTr.doc.type.schema.nodes.body.create(undefined, stepContent)

  if (stepContent.firstChild && stepContent.firstChild.type === newTr.doc.type.schema.nodes.section_title) {
    wrapper = newTr.doc.type.schema.nodes.section.create(undefined, stepContent)
  }

  // add reference change to the adjacent node to the converted paragraph
  // that will be used to return content after the reference on rejection
  if (action === 'convert-to-section' && !sameActionDataTracked) {
    wrapper.nodesBetween(0, differentPos, (node, pos) => {
      if (pos + node.nodeSize === differentPos) {
        let dataTracked = getBlockInlineTrackedData(node) || []
        dataTracked = [
          addTrackIdIfDoesntExist(trackUtils.createNewReferenceAttrs(attrs, moveNodeId, true)),
          ...dataTracked,
        ]
        wrapper = wrapper.replace(
          pos,
          pos + node.nodeSize,
          new Slice(Fragment.from(node.type.create({ ...node.attrs, dataTracked }, node.content)), 0, 0)
        )
        return false
      }
    })
  }

  wrapper.nodesBetween(differentPos, stepContent.size, (node, pos, _, index) => {
    if (pos < differentPos) {
      return
    }

    if (action === 'convert-to-paragraph' && !sameActionDataTracked) {
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

    if (action === 'convert-to-section') {
      const sectionTitle = schema.nodes.section_title.create(
        { ...node.firstChild?.attrs, dataTracked },
        node.firstChild?.content
      )
      node = node.copy(Fragment.from(sectionTitle).append(node.slice(sectionTitle.nodeSize).content))
      dataTracked = secDataTracked
    }

    if (index > 1 && pos !== differentPos) {
      dataTracked = getBlockInlineTrackedData(node) || []
    }

    const structureChange = (sameActionDataTracked && []) || [
      addTrackIdIfDoesntExist(
        trackUtils.createNewStructureAttrs(
          { ...attrs, moveNodeId },
          action,
          sectionLevel,
          isThereSectionBefore,
          isSupSection
        )
      ),
    ]

    wrapper = wrapper.replace(
      pos,
      pos + node.nodeSize,
      new Slice(
        Fragment.from(
          node.type.create(
            {
              ...node.attrs,
              dataTracked: [...structureChange, ...dataTracked],
            },
            node.content
          )
        ),
        0,
        0
      )
    )
    return false
  })

  if (sameActionDataTracked) {
    return cleanUpDataTracked(
      wrapper.content,
      sameActionDataTracked,
      dataTracked,
      secDataTracked,
      oldState,
      newTr
    )
  }

  return Fragment.from(wrapper.content)
}
