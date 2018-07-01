import 'fuse-box/core/File';
import { Plugin } from 'fuse-box/core/WorkflowContext';
import { BundleProducer } from 'fuse-box/core/BundleProducer';
import * as fs from 'fs';
import { ensureAbsolutePath, joinFuseBoxPath } from 'fuse-box/Utils';
import * as path from 'path';

export interface TagInfo {
    orderNum?: number;
    tag: string;
}

export interface WebIndexPluginOptions {
    // The main filename. Default is `index.html`.
    outFilePath?: string;
    // The relative url bundles are served from. Default is `/`. Empty is set with `.`
    publicPath?: string;
    tags?: {
        // Template placeholder names. Bundle tags all start with a '$'.
        // Leaving any of these as 'undefined' will generate a default tag and order.
        $scriptBundles?: (bundlePath: string, filename: string) => TagInfo;
        $cssBundles?: (bundlePath: string, filename: string) => TagInfo;
        other?: {
            // Key value pairs. The keys can be anything you want although I prefer staying with a '$' for consitency.
            [key: string]: string;
        };
    };
    // Templates are callback that return a ES6 template string.
    // Provide a path to your own template.
    template?: ((state: any) => string) | string;
}

export class WebIndexPlugin implements Plugin {
    private opts: undefined | WebIndexPluginOptions;

    constructor(options?: WebIndexPluginOptions) {
        this.opts = options;
    }

    public producerEnd(producer: BundleProducer) {
        this.generate(producer);
        producer.sharedEvents.on('file-changed', () => {
            this.generate(producer);
        });
    }

    private generateDefaultTemplate(state: { cssBundles: string; scriptBundles: string }) {
        return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                ${state.cssBundles}
            </head>
            <body>
                ${state.scriptBundles}
            </body>
        </html>
        `;
    }

    private async generate(producer: BundleProducer) {
        const opts = this.opts;
        const publicPath = opts && opts.publicPath ? opts.publicPath : '/';
        const outFilePath = opts && opts.outFilePath ? opts.outFilePath : 'index.html';
        const scriptBundleTransformer =
            opts && opts.tags && opts.tags.$scriptBundles ? opts.tags.$scriptBundles : null;
        const cssBundleTransformer =
            opts && opts.tags && opts.tags.$cssBundles ? opts.tags.$cssBundles : null;
        const otherTags = opts && opts.tags && opts.tags.other ? opts.tags.other : null;

        // Create JavaScript tag entries.
        const scriptTagInfos: TagInfo[] = [];
        let scriptTags = '';

        const bundles = producer.sortBundles();

        bundles.forEach((bundle) => {
            // Exclude chunk files that will always be lazy loaded by import('./filename') syntax.
            if (bundle.webIndexed === true) {
                const output = bundle.context.output;

                if (output && output.lastPrimaryOutput) {
                    // Generate file path.
                    const bundlePath = joinFuseBoxPath(
                        output.folderFromBundleName || '',
                        output.lastPrimaryOutput.filename
                    );

                    // Get filename.
                    const filename = `${path.basename(bundlePath, '.js')}.js`;

                    // Generate tags.
                    if (scriptBundleTransformer !== null) {
                        const tagInfo = scriptBundleTransformer(
                            `${path.join(publicPath, bundlePath)}`,
                            filename
                        );

                        if (tagInfo) {
                            scriptTagInfos.push(tagInfo);
                        }
                    } else {
                        scriptTags += `\n<script type="text/javascript" src=${path.join(
                            publicPath,
                            bundlePath
                        )} defer></script>`;
                    }
                }
            }
        });

        if (scriptBundleTransformer !== null) {
            scriptTags += this.createTagsFromTagInfos(scriptTagInfos);
        }

        // Create CSS tag entries.
        const cssTagInfos: TagInfo[] = [];
        let cssTags = '';

        if (producer.injectedCSSFiles.size > 0) {
            producer.injectedCSSFiles.forEach((bundlePath) => {
                // Get filename.
                const filename = `${path.basename(bundlePath, '.css')}.css`;

                // Generate tags.
                if (cssBundleTransformer !== null) {
                    const tagInfo = cssBundleTransformer(
                        `${path.join(publicPath, bundlePath)}`,
                        filename
                    );

                    if (tagInfo) {
                        cssTagInfos.push(tagInfo);
                    }
                } else {
                    cssTags += `<link rel="stylesheet" href="${path.join(
                        publicPath,
                        bundlePath
                    )}">`;
                }
            });
        }

        if (cssBundleTransformer !== null) {
            cssTags += this.createTagsFromTagInfos(cssTagInfos);
        }

        // Create template state from bundles.
        const templateState = {
            scriptBundles: scriptTags,
            cssBundles: cssTags
        };

        // Create other tags entries.
        if (otherTags !== null) {
            for (const key in otherTags) {
                // Remove $ if it exist.
                if (key.charAt(0) === '$') {
                    templateState[key.substring(1)] = otherTags[key];
                } else {
                    templateState[key] = otherTags[key];
                }
            }
        }
        // console.log(templateState);

        // Acquire index.html template.
        let indexHTML;

        // Hydrate .html template.
        if (opts && opts.template) {
            const createIndex =
                typeof opts.template === 'string'
                    ? require(ensureAbsolutePath(opts.template)).default ||
                      require(ensureAbsolutePath(opts.template))
                    : opts.template;

            indexHTML = createIndex(templateState);
        } else {
            indexHTML = this.generateDefaultTemplate(templateState);
        }

        // Write .html file to disk.
        producer.fuse.context.output.writeToOutputFolder(outFilePath, indexHTML);
    }

    private createTagsFromTagInfos(tagInfos: TagInfo[]) {
        let tags = '';

        // Sort script bundles by declared order.
        tagInfos.sort((a: TagInfo, b: TagInfo) => {
            return (a.orderNum ? a.orderNum : 0) - (b.orderNum ? b.orderNum : 0);
        });

        let i = -1;
        while (++i < tagInfos.length) {
            tags += tagInfos[i].tag;
        }

        return tags;
    }
}

export default (opts?: WebIndexPluginOptions) => {
    return new WebIndexPlugin(opts);
};
