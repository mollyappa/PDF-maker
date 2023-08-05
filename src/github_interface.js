#!/usr/bin/env node
'use strict';
const fs = require("fs");
const path = require("path");
const md2pdf = require('./markdown-to-pdf');
const axios = require('axios');

const DEFAULT_THEME_FILE = '/styles/markdown.css';
const DEFAULT_HIGHLIGHT_FILE = '/styles/highlight.css';
const DEFAULT_TEMPLATE_FILE = '/template/template.html';
const RUNNER_DIR = '/github/workspace/';


function getRunnerInput(name, def, transformer = val => val) {
    let value = process.env['INPUT_' + name.toUpperCase()];

    return (value === undefined || value === '') ? def : transformer(value);
}

function getRunnerPath(file) {
    file = path.normalize(RUNNER_DIR + file);

    if (!file.startsWith(RUNNER_DIR)) throw `Cannot move outside of directory '${RUNNER_DIR}'`;

    return file;
}

function booleanTransformer(bool) {
    return bool === 'true';
}

// Process given input_path and set flag indicating if it is a directory or single file path
// getRunnerInput for input_dir is passed as the fallback value for backwards compatibility
let InputPath = getRunnerInput(
    'input_path',
    getRunnerInput('input_dir', '', getRunnerPath),
    getRunnerPath
);
let InputPathIsDir = false
try {
    InputPathIsDir = fs.lstatSync(InputPath).isDirectory();
} catch {
    throw `Given input path, ${InputPath}, was not found in filesystem!`;
}

if (InputPathIsDir) {
    InputPath += InputPath.endsWith("/") ? "" : "/"
}

// Other GitHub Action inputs that are needed for this program to run
const ImageImport = getRunnerInput('image_import', null);
const ImageDir = getRunnerInput('images_dir',
    InputPathIsDir ? InputPath : path.dirname(InputPath) + '/' +
        md2pdf.nullCoalescing(ImageImport, ''),
    getRunnerPath);

// Optional input, though recommended
let OutputDir = getRunnerInput('output_dir', 'built', getRunnerPath);
let OutputDirIsDir = false
try {
    OutputDirIsDir = fs.lstatSync(OutputDir).isDirectory();
} catch { }
if (!OutputDirIsDir) {
    OutputDir += OutputDir.endsWith("/") ? "" : "/"
    CreateOutputDirectory(OutputDir);
}

// Whether to also output a <filename>.html file, there is a bit of magic at the end to ensure that the value is a boolean
const build_html = getRunnerInput('build_html', false, booleanTransformer);

// Whether to also output a <filename>.pdf file, there is a bit of magic at the end to ensure that the value is a boolean
// This was requested in #36. No idea why...
const build_pdf = getRunnerInput('build_pdf', true, booleanTransformer);

// Custom CSS and HTML files for theming
const ThemeFile = getRunnerInput('theme', null, getRunnerPath);
const HighlightThemeFile = getRunnerInput('highlight_theme', DEFAULT_HIGHLIGHT_FILE, getRunnerPath);
const TemplateFile = getRunnerInput('template', DEFAULT_TEMPLATE_FILE, getRunnerPath);

// Whether to extend your custom CSS file with the default theme
const extend_default_theme = getRunnerInput('extend_default_theme', true, booleanTransformer);

// Table Of Contents settings
const table_of_contents = getRunnerInput('table_of_contents', false, booleanTransformer);


// CreateOutputDirectory creates the output directory if it doesn't exist
function CreateOutputDirectory(dirname) {
    if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname);
    }
}

// GetMarkdownFiles returns an array of only files ending in .md or .markdown
// NOTE: When a file name is the same, eg. happy.md and happy.markdown, only one file is
// outputted as it will be overwritten. This needs to be checked. (TODO:)
function GetMarkdownFiles(files) {
    return files.filter(function (filePath) {
        if (path.extname(filePath).match(/^(.md|.markdown)$/)) {
            return true;
        }
    });
}

// GetFileBody retrieves the file content as a string
function GetFileBody(file) {
    return md2pdf.getFileContent(
        (InputPathIsDir ? InputPath + file : InputPath)
    );
}



// BuildHTML outputs the HTML string to a file
function BuildHTML(result, file) {
    file = UpdateFileName(file, 'html');
    result.writeHTML(OutputDir + file);
    console.log('Built HTML file: ' + file);
}
/*
function getRepositoryName() {
    const repoUrl = process.env['GITHUB_REPOSITORY'];
    if (!repoUrl) {
        console.error('GITHUB_REPOSITORY environment variable is not available. Cannot determine repository name.');
        return null;
    }

    const repoParts = repoUrl.split('/');
    if (repoParts.length !== 2) {
        console.error('Invalid GITHUB_REPOSITORY format. Expected "owner/repo".');
        return null;
    }

    const repositoryName = repoParts[1];
    return repositoryName;
}
*/

async function getRepositoryName() {
    const repoUrl = process.env['GITHUB_REPOSITORY'];
    if (!repoUrl) {
      console.error('GITHUB_REPOSITORY environment variable is not available. Cannot determine repository name.');
      return null;
    }
  
    const repoParts = repoUrl.split('/');
    if (repoParts.length !== 2) {
      console.error('Invalid GITHUB_REPOSITORY format. Expected "owner/repo".');
      return null;
    }
  
    const repositoryName = repoParts[1];
    return repositoryName;
  }
  
async function getLatestReleaseVersion() {
    const repoUrl = process.env['GITHUB_REPOSITORY'];
    if (!repoUrl) {
      console.error('GITHUB_REPOSITORY environment variable is not available. Cannot determine repository name.');
      return '0.0.0';
    }
  
    const repoParts = repoUrl.split('/');
    if (repoParts.length !== 2) {
      console.error('Invalid GITHUB_REPOSITORY format. Expected "owner/repo".');
      return '0.0.0';
    }
  
    const owner = repoParts[0];
    const repo = repoParts[1];
  
    try {
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/tags`);
      const latestTagVersion = response.data[0].name;
      return latestTagVersion;
    } catch (error) {
      console.error('Error fetching latest release information:', error.message);
      return '0.0.0';
    }
  }



  function UpdateFileName(fileName, extension) {
    const baseName = fileName.replace(/\.[^/.]+$/, ''); // Remove the existing extension
    const updatedFileName = extension ? `${baseName}.${extension}` : baseName;
    return updatedFileName;
}

async function BuildPDF(result, file) {
    const repositoryName = await getRepositoryName();
    const tagVersion = await getLatestReleaseVersion();
    const file_name = getRunnerInput('output_name', repositoryName);

    // Custom function to generate a unique name for the PDF file based on the repository name and tag version
    function generatePDFFileName(file_name, tagVersion, existingFiles) {
        let baseFileName = UpdateFileName(file_name + ' ' + tagVersion, 'pdf');
        let fileName = baseFileName;
        let index = 1;

        while (existingFiles.includes(fileName)) {
            fileName = UpdateFileName(`${baseFileName} (${index})`, 'pdf');
            index++;
        }

        return fileName;
    }

    // Build the final name for the PDF file
    const existingFiles = await new Promise((resolve, reject) => {
        fs.readdir(OutputDir, (err, files) => {
            if (err) reject(err);
            else resolve(files);
        });
    });

    let pdfFileName = generatePDFFileName(file_name, tagVersion, existingFiles);

    // Write the PDF file
    result.writePDF(OutputDir + pdfFileName);
    console.log('Built PDF file: ' + pdfFileName);
}


async function ConvertMarkdown(file) {
    // Get the content of the MD file and convert it
    console.log('Converting: ' + file);
    let result = await md.convert(
        GetFileBody(file),
    ).catch(function (err) {
        throw ` Trouble converting markdown files: ${err}`;
    });

    // If the `build_html` environment variable is true, build the HTML
    if (build_html === true) {
        BuildHTML(result, file);
    }

    // Build the PDF file
    if (build_pdf === true) {
        await BuildPDF(result, file);     
        console.log('Built PDF file: ' + file);
    }
}
// Assign the style and template files to strings for later manipulation
const style = (extend_default_theme ? md2pdf.getFileContent(DEFAULT_THEME_FILE) : '')
    + (ThemeFile === null ? '' : md2pdf.getFileContent(ThemeFile))
    + md2pdf.getFileContent(HighlightThemeFile);
const template = md2pdf.getFileContent(TemplateFile);

let md = new md2pdf({
    image_import: ImageImport,
    image_dir: ImageDir,

    style: style,
    template: template,

    table_of_contents: table_of_contents,
});
md.start();

if (InputPathIsDir) {
    // Handle case that user supplied path to directory of markdown files

    fs.readdir(InputPath, async function (err, files) {
        files = GetMarkdownFiles(files);
        if (files.length === 0) throw 'No markdown files found! Exiting.';

        console.log('Markdown files found: ' + files.join(', '));

        // Loop through each file converting it
        for (let file of files) {
            await ConvertMarkdown(file).catch(function (err) {
                throw ` Trouble converting markdown files: ${err}`;
            })
        }

        // Close the image server
        md.close();
    });
} else {
    // Handle case that user supplied path to one markdown file

    // This is wrapped in an anonymous function to allow async/await.
    // This could be abstracted into a standalone function easily in the future
    // but it is currently single-use so this seemed appropriate.
    (async () => {
        const files = GetMarkdownFiles([path.basename(InputPath)]);
        if (files.length === 0) throw 'No markdown file found! Exiting.';

        console.log('Markdown file found: ' + files, files[0]);

        // Convert the file
        await ConvertMarkdown(files[0]).catch(function (err) {
            throw ` Trouble converting markdown files: ${err}`;
        })

        // Close the image server
        md.close();
    })();
}
