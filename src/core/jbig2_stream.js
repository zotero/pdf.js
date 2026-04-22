/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { shadow, unreachable } from "../shared/util.js";
import { BaseStream } from "./base_stream.js";
import { DecodeStream } from "./decode_stream.js";
import { Dict } from "./primitives.js";
import { JBig2CCITTFaxImage } from "./jbig2_ccittFax.js";

/**
 * For JBIG2's we use a library to decode these images and
 * the stream behaves like all the other DecodeStreams.
 */
class Jbig2Stream extends DecodeStream {
  constructor(stream, maybeLength, params) {
    super(maybeLength);

    this.stream = stream;
    this.dict = stream.dict;
    this.maybeLength = maybeLength;
    this.params = params;
  }

  get bytes() {
    // If `this.maybeLength` is null, we'll get the entire stream.
    return shadow(this, "bytes", this.stream.getBytes(this.maybeLength));
  }

  ensureBuffer(requested) {
    // No-op, since `this.readBlock` will always parse the entire image and
    // directly insert all of its data into `this.buffer`.
  }

  readBlock() {
    unreachable("Jbig2Stream.readBlock");
  }

  get isAsyncDecoder() {
    return true;
  }

  get isImageStream() {
    return true;
  }

  async decodeImage(bytes, length, _decoderOptions) {
    if (this.eof) {
      return this.buffer;
    }
    bytes ||= this.bytes;

    let globals = null;
    if (this.params instanceof Dict) {
      const globalsStream = this.params.get("JBIG2Globals");
      if (globalsStream instanceof BaseStream) {
        globals = globalsStream.getBytes();
      }
    }
    this.buffer = await JBig2CCITTFaxImage.decode(
      bytes,
      this.dict.get("Width"),
      this.dict.get("Height"),
      globals
    );
    this.bufferLength = this.buffer.length;
    this.eof = true;

    return this.buffer;
  }

  get canAsyncDecodeImageFromBuffer() {
    return this.stream.isAsync;
  }
}

export { Jbig2Stream };
