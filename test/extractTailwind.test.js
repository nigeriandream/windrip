const { extractTailwind } = require('../src/index');
const fs = require('fs/promises');
const glob = require('glob');

jest.mock('fs/promises');
jest.mock('glob');
jest.mock('puppeteer');
jest.mock('http-server');

describe('extractTailwind', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('processes a PHP file', async () => {
        fs.stat.mockResolvedValue({ isDirectory: () => true });
        fs.mkdir.mockResolvedValue();
        fs.readFile.mockResolvedValue('<div class="font-bold text-center">Test</div>');
        fs.writeFile.mockResolvedValue();
        glob.mockImplementation(() => Promise.resolve(['test.php']));

        await extractTailwind({
            input: 'src',
            outputDir: 'windrip',
            fileExtensions: ['php'],
            dryRun: true,
            verbose: true,
        });

        expect(fs.writeFile).toHaveBeenCalled();
    });
});