const { BackupManager } = require('../src/index');
const fs = require('fs/promises');

jest.mock('fs/promises');

describe('BackupManager', () => {
    let consoleWarnSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    test('backs up a file when enabled', async () => {
        const manager = new BackupManager(true);
        fs.readFile.mockResolvedValue('test content');
        await manager.backup('test.php');
        expect(fs.readFile).toHaveBeenCalledWith('test.php', 'utf-8');
        expect(manager.backups.get('test.php')).toBe('test content');
    });

    test('does not back up when disabled', async () => {
        const manager = new BackupManager(false);
        await manager.backup('test.php');
        expect(fs.readFile).not.toHaveBeenCalled();
        expect(manager.backups.size).toBe(0);
    });

    test('handles backup errors gracefully', async () => {
        const manager = new BackupManager(true);
        fs.readFile.mockRejectedValue(new Error('File not found'));
        await manager.backup('test.php');
        expect(manager.backups.size).toBe(0);
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to backup test.php'));
    });

    test('restores a backed-up file', async () => {
        const manager = new BackupManager(true);
        fs.readFile.mockResolvedValue('test content');
        await manager.backup('test.php');
        fs.writeFile.mockResolvedValue();
        await manager.restore('test.php');
        expect(fs.writeFile).toHaveBeenCalledWith('test.php', 'test content');
    });

    test('does not restore if no backup exists', async () => {
        const manager = new BackupManager(true);
        const result = await manager.restore('test.php');
        expect(result).toBe(false);
        expect(fs.writeFile).not.toHaveBeenCalled();
    });
});