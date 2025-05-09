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
/// <reference types="@types/jest" />;
import { schema as manuscriptSchema } from '@manuscripts/transform'
import { promises as fs } from 'fs'
import { baseKeymap } from 'prosemirror-commands'
import { NodeSelection } from 'prosemirror-state'

import { CHANGE_STATUS, ChangeSet, NodeAttrChange, trackChangesPluginKey, trackCommands } from '../../src'
import { TrackChangesAction } from '../../src/actions'
import { log } from '../../src/utils/logger'
import docs from '../__fixtures__/docs'
import { schema } from '../utils/schema'
import { setupEditor } from '../utils/setupEditor'
import basicNodeDelete from './basic-node-del.json'
import basicNodeInsert from './basic-node-ins.json'
import blockNodeAttrUpdate from './block-node-attr-update.json'
import inlineNodeAttrUpdate from './inline-node-attr-update.json'
import tableDiff from './table-attr-update.json'
import wrapWithLink from './wrap-with-link.json'

let counter = 0
// https://stackoverflow.com/questions/65554910/jest-referenceerror-cannot-access-before-initialization
// eslint-disable-next-line
var uuidv4Mock: jest.Mock

jest.mock('../../src/utils/uuidv4', () => {
  const mockOriginal = jest.requireActual('../../src/utils/uuidv4')
  uuidv4Mock = jest.fn(() => `MOCK-ID-${counter++}`)
  return {
    __esModule: true,
    ...mockOriginal,
    uuidv4: uuidv4Mock,
  }
})
jest.mock('../../src/utils/logger')
jest.useFakeTimers().setSystemTime(new Date('2020-01-01').getTime())

describe('nodes.test', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
  })

  test('should track inserts of paragraphs', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    }).insertNode(schema.nodes.paragraph.createAndFill(), 0)

    expect(tester.toJSON()).toEqual(basicNodeInsert)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should prevent deletion of paragraphs unless already inserted', async () => {
    const tester = setupEditor({
      doc: docs.blockquoteMarks,
    })
      .insertNode(schema.nodes.paragraph.create(), 0)
      .moveCursor('start')
      .insertText('inserted text')

    expect(tester.toJSON()).toEqual(basicNodeDelete[0])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    tester.cmd((state, dispatch) => {
      dispatch(state.tr.delete(0, state.doc.nodeSize - 2))
    })
    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))
    // Contains paragraph insert since the default doc must have at least one child paragraph,
    // thus PM tries to automatically fill it when it's destroyed. However, in our case that's
    // not ideal but it's not fixed for now, since deleting the whole doc at once can't be done by user.
    expect(tester.toJSON()).toEqual(basicNodeDelete[1])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(11)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should create insert & delete operations on inline node attribute change', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .insertNode(
        schema.nodes.image.createAndFill({
          src: 'https://i.imgur.com/lFAxY.png',
          title: 'Image',
        }),
        1
      )
      .cmd((state, dispatch) => {
        const trackChangesState = trackChangesPluginKey.getState(state)
        if (!trackChangesState) {
          return false
        }
        const { changeSet } = trackChangesState
        const ids = ChangeSet.flattenTreeToIds(changeSet.pending)
        trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)(state, dispatch)
        return true
      })
      .cmd((state, dispatch) => {
        dispatch(
          state.tr.setNodeMarkup(1, undefined, {
            src: 'https://i.imgur.com/WdH20od.jpeg',
            title: 'Changed title',
          })
        )
      })
    // await fs.writeFile('inline.json', JSON.stringify(tester.toJSON()))
    expect(tester.toJSON()).toEqual(inlineNodeAttrUpdate)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(3)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should correctly track only inserted link leaving its text content untouched', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      // Wrap 'Hello' with link
      .selectText(1, 6)
      .wrapInInline(schema.nodes.link)

    expect(tester.toJSON()).toEqual(wrapWithLink[0])

    tester.cmd((state, dispatch) => {
      dispatch(
        state.tr.setNodeMarkup(1, undefined, {
          href: 'https://testing.testing',
          title: 'I am a title',
        })
      )
    })

    expect(tester.toJSON()).toEqual(wrapWithLink[1])

    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(4)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should convert insert+delete block node into single update attr operation', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .insertNode(schema.nodes.equation_wrapper.createAndFill(), 1)
      .cmd((state, dispatch) => {
        dispatch(state.tr.setSelection(NodeSelection.create(state.doc, 3)))
      })
      .cmd((state, dispatch) => {
        const trackChangesState = trackChangesPluginKey.getState(state)
        if (!trackChangesState) {
          return false
        }
        const { changeSet } = trackChangesState
        const ids = ChangeSet.flattenTreeToIds(changeSet.pending)
        trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)(state, dispatch)
        return true
      })

    expect(tester.toJSON()).toEqual(blockNodeAttrUpdate[0])

    tester.cmd((state, dispatch) => {
      dispatch(
        state.tr.setNodeMarkup(3, undefined, {
          TeXRepresentation: '1+1=2',
        })
      )
    })

    // await fs.writeFile('todo.json', JSON.stringify(tester.toJSON()))
    expect(tester.toJSON()).toEqual(blockNodeAttrUpdate[1])
  })

  test('should avoid deleting table content between gap, generating one node update', async () => {
    const tester = setupEditor({
      doc: docs.table,
      useDefaultPlugins: true,
      schema,
    }).setNodeMarkup(13, { testAttribute: 'changed' })

    expect(tester.toJSON()).toEqual(tableDiff[0])
    expect(uuidv4Mock.mock.calls.length).toBe(2)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should track meta node attribute updates', async () => {
    const tester = setupEditor({
      doc: docs.bibliographySection,
      schema: manuscriptSchema,
    }).cmd((state, dispatch) => {
      const node = state.doc.resolve(14).node()
      dispatch(
        state.tr
          .setNodeMarkup(14, undefined, {
            ...node.attrs,
            title: 'Schizophrenia-a',
          })
          .setMeta(TrackChangesAction.updateMetaNode, true)
      )
      return true
    })

    const nodeAttrChange = tester.trackState()?.changeSet.nodeAttrChanges[0] as NodeAttrChange
    expect(nodeAttrChange.oldAttrs['title']).toEqual(
      'Schizophrenia-a high-risk factor for suicide: clues to risk reduction.'
    )
    expect(nodeAttrChange.newAttrs['title']).toEqual('Schizophrenia-a')
    expect(uuidv4Mock.mock.calls.length).toBe(2)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  // TODO:: this example of sending multiple steps in one transaction for the same node. it's going to be a reference to fix it later
  test.skip('should track inserting list with with multiple paragraph selected', async () => {
    const tester = setupEditor({
      doc: docs.list,
    })
      .selectText(37, 44)
      .wrapInList(schema.nodes.bullet_list)

    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test.skip('should track node attribute updates', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    }).cmd((state, dispatch) => {
      const cursor = state.selection.head
      const blockNodePos = state.doc.resolve(cursor).start(1) - 1
      if (state.doc.resolve(blockNodePos).nodeAfter?.type === state.schema.nodes.paragraph && dispatch) {
        dispatch(
          state.tr.setNodeMarkup(blockNodePos, undefined, {
            testAttribute: 'changed',
          })
        )
        return true
      }
      return false
    })

    await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    expect(tester.toJSON()).toEqual(blockNodeAttrUpdate)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should track node split', async () => {
    const tester = setupEditor({
      doc: docs.list,
    })
      .selectText(60)
      .cmd(baseKeymap['Enter'])

    const changeSet = tester.trackState()?.changeSet
    expect(
      changeSet?.pending.find((change) => change.dataTracked.operation === 'node_split')
    ).not.toBeUndefined()

    expect(tester.trackState()?.changeSet?.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(4)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should return back node split content on rejection to the donor node', async () => {
    const tester = setupEditor({
      doc: docs.list,
    })
      .selectText(60)
      .cmd(baseKeymap['Enter'])

    const nodeSplitChange = tester
      .trackState()
      ?.changeSet?.pending.find((change) => change.dataTracked.operation === 'node_split')
    expect(nodeSplitChange).not.toBeUndefined()

    tester.cmd((state, dispatch) => {
      if (nodeSplitChange) {
        trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, [nodeSplitChange.id])(state, dispatch)
      }
    })

    expect(tester.view.state.doc.nodeAt(45)?.nodeSize).toEqual(262)

    expect(tester.trackState()?.changeSet?.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(4)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should update change reference for the second node split change on rejection', async () => {
    const tester = setupEditor({
      doc: docs.list,
    })
      .selectText(60)
      .cmd(baseKeymap['Enter'])
      .selectText(74)
      .cmd(baseKeymap['Enter'])

    tester.cmd((state, dispatch) => {
      // reject first split
      const nodeSplitChange = tester.trackState()?.changeSet.changes.find((change) => change.from === 61)
      if (nodeSplitChange) {
        trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, [nodeSplitChange.id])(state, dispatch)
      }
    })

    const changes = tester.trackState()?.changeSet.changes
    const nodeSplitChange = changes?.find((change) => change.dataTracked.operation === 'node_split')
    const referenceChange = changes?.find((change) => change.type === 'reference-change')

    expect((referenceChange?.dataTracked as any).referenceId).toBe(nodeSplitChange?.id)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should revert node delete change on rejecting node split change', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .selectText(7)
      .cmd(baseKeymap['Enter'])
      .delete(0, 7)

    tester.cmd((state, dispatch) => {
      const nodeSplitChange = tester
        .trackState()
        ?.changeSet.changes.find((change) => change.dataTracked.operation === 'node_split')
      if (nodeSplitChange) {
        trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, [nodeSplitChange.id])(state, dispatch)
      }
    })

    expect(tester.trackState()?.changeSet.bothNodeChanges.length).toEqual(0)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should delete node with dataTracked as Insert and delete nodes that without dataTracked in the same transaction', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .insertNode(schema.nodes.paragraph.create(undefined, schema.text('inserted paragraph')), 0)
      .insertNode(schema.nodes.paragraph.create(undefined, schema.text('inserted paragraph')), 0)
      .insertNode(schema.nodes.paragraph.create(undefined, schema.text('inserted paragraph')), 0)
      .cmd((state, dispatch) => dispatch(state.tr.delete(60, 73).delete(40, 60).delete(20, 40).delete(0, 20)))

    expect(tester.view.state.doc.content.childCount).toBe(2)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(2) // that is expected, as in processChangeSteps after we delete inserted node the `delete-text` change will log can't find node error as we remove it is parent node before
  })

  test('should delete and insert node in the same transaction', async () => {
    const paragraph = schema.nodes.paragraph.create(undefined, schema.text('inserted paragraph'))
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .insertNode(paragraph, 0)
      .insertNode(paragraph, 0)
      .setChangeStatuses()
      .cmd((state, dispatch) => {
        dispatch(
          state.tr
            .insert(0, paragraph)
            .insert(20, paragraph)
            .delete(80, 93)
            .delete(60, 80)
            .insert(60, paragraph)
            .delete(60, 80)
        )
      })

    expect(tester.view.state.doc.content.childCount).toBe(6)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should insert parent node then insert child node in the same transaction', async () => {
    const tester = setupEditor({
      doc: docs.manuscriptSimple[0],
      schema: manuscriptSchema,
    }).cmd((state, dispatch) => {
      const tr = state.tr

      const tableFooter = manuscriptSchema.nodes.table_element_footer.create()
      tr.insert(144, tableFooter)

      const generalTableFootnote = manuscriptSchema.nodes.general_table_footnote.create({}, [
        manuscriptSchema.nodes.paragraph.create(),
      ])
      tr.insert(145, generalTableFootnote)

      dispatch(tr)
    })

    expect(tester.view.state.doc.nodeAt(144)?.type.name).toBe(
      manuscriptSchema.nodes.table_element_footer.name
    )
    expect(tester.view.state.doc.nodeAt(145)?.type.name).toBe(
      manuscriptSchema.nodes.general_table_footnote.name
    )
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(1)
  })
})
