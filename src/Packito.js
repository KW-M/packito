/**
 * Copyright (c) Mik BRY
 * mik@miklabs.com
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import fs from 'fs';
import path from 'path';
import spawn from './utils/spawn';

const fsp = fs.promises;

export default class Packito {
  constructor(outputDir, noPublish, publisherArguments, cliOutput) {
    this.outputDir = outputDir;
    this.noPublish = noPublish;
    this.publisherArguments = publisherArguments;
    this.cliOutput = cliOutput;
  }

  async readJSONFile(fileName, dir = './') {
    const f = path.join(dir, fileName);
    let filehandle = null;
    let result = null;
    try {
      filehandle = await fsp.open(f, 'r');
      const raw = await filehandle.readFile();
      result = JSON.parse(raw);
    } catch (error) {
      this.error = error;
    } finally {
      if (filehandle) {
        await filehandle.close();
      }
    }
    return result;
  }

  async readOptions(optionsFile = '.packito.json', dir = './') {
    let options = await this.readJSONFile(optionsFile, dir);
    if (!options) {
      // Default options
      options = {
        remove: {
          devDependencies: '*',
          script: '*',
        },
        copy: ['README.md', 'LICENSE'],
      };
    }
    this.options = options;
    return options;
  }

  async transform(_pkg, _options) {
    const pkg = _pkg || (await this.readJSONFile('package.json'));
    const options = _options || (await this.readOptions());
    const { remove, replace } = options;
    if (typeof remove === 'object') {
      Object.keys(remove).forEach((e) => {
        if (remove[e] || remove[e] === '*') {
          delete pkg[e];
        }
      });
    }
    if (typeof replace === 'object') {
      Object.keys(replace).forEach((e) => {
        if (replace[e]) {
          pkg[e] = replace[e];
        }
      });
    }
    if (typeof options.publisher === 'object') {
      this.publisher = options.publisher;
    } else if (typeof options.publisher === 'string') {
      this.publisher = { name: options.publisher };
    }
    this.pkg = pkg;
    this.data = JSON.stringify(this.pkg, null, '\t');
    // TODO handle publisher
    return this.pkg;
  }

  async copyRecursive(file, outputDir) {
    try {
      if (fsp.cp) {
        await fsp.cp(file, path.join(outputDir, path.basename(file)), { recursive: true, dereference: true });
      } else {
        // maintain backwards compatibility with node 10
        await fsp.copyFile(file, path.join(outputDir, path.basename(file)));
      }
    } catch (error) {
      if (error.code === 'EISDIR') {
        const files = await fsp.readdir(file);
        await Promise.all(files.map((f) => this.copyRecursive(path.join(file, f), path.join(outputDir, file))));
      } else if (this.cliOutput) {
        this.cliOutput.error(
          `Could not copy ${file} to ${path.join(outputDir, path.basename(file))}, ${error.toString()}`,
        );
      }
    }
  }

  async write(packageFile = 'package.json') {
    let filehandle = null;
    let outputDir = this.options ? this.options.output : undefined;
    this.error = undefined;
    if (!outputDir) {
      ({ outputDir } = this);
    }
    try {
      await fsp.mkdir(outputDir, { recursive: true });
    } catch (error) {
      //
    }
    try {
      const f = path.join(outputDir, packageFile);
      // TODO test if outputDir exist
      filehandle = await fsp.open(f, 'w');
      if (!this.data) {
        await this.transform();
      }
      await filehandle.writeFile(this.data);
    } catch (error) {
      this.error = error;
    } finally {
      if (filehandle) {
        await filehandle.close();
      }
    }
    if (this.options && Array.isArray(this.options.copy)) {
      await Promise.all(this.options.copy.map((e) => this.copyRecursive(e, outputDir)));
    }
  }

  async publish(con) {
    if (!this.noPublish && (this.publisher || this.publisherArguments)) {
      let [exe, ...args] = this.publisherArguments || [];
      if (!exe) {
        [exe, ...args] = this.publisher.name.split(' ');
      }
      return spawn(exe, args, undefined, con);
    }
    return { code: -1 };
  }
}
