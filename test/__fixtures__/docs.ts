/*!
 * © 2022 Atypon Systems LLC
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
import paragraph from './starting-docs/paragraph.json'
import manyParagraphs from './starting-docs/many-paragraphs.json'
import blockquoteMarks from './starting-docs/blockquote-marks.json'
import nestedBlockquotes from './starting-docs/nested-blockquotes.json'

import basicNodeDelete from './basic-node-del.json'
import basicNodeInsert from './basic-node-ins.json'
import basicTextDelete from './basic-text-del.json'
import basicTextInconsistent from './basic-text-inconsistent-track.json'
import basicTextInsert from './basic-text-ins.json'
import basicTextJoin from './basic-text-join.json'
import blockNodeAttrUpdate from './block-node-attr-update.json'
import inlineNodeAttrUpdate from './inline-node-attr-update.json'
import insertAccept from './insert-accept.json'
import insertReject from './insert-reject.json'
import manuscriptApplied from './manuscript-applied.json'
import manuscriptDefaultDocs from './manuscript-default-docs.json'
import repeatedDelete from './repeated-delete.json'
import replaceAroundSteps from './replace-around-steps.json'
import variousOpenEndedSlices from './various-open-ended-slices.json'
import wrapWithLink from './wrap-with-link.json'

export default {
  startingDocs: {
    paragraph,
    manyParagraphs,
    blockquoteMarks,
    nestedBlockquotes,
  },
  basicNodeDelete,
  basicNodeInsert,
  basicTextDelete,
  basicTextInconsistent,
  basicTextInsert,
  basicTextJoin,
  blockNodeAttrUpdate,
  inlineNodeAttrUpdate,
  insertAccept,
  insertReject,
  manuscriptApplied,
  manuscriptDefaultDocs,
  repeatedDelete,
  replaceAroundSteps,
  variousOpenEndedSlices,
  wrapWithLink,
}
