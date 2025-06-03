const { extractClasses } = require('../src/index');

describe('extractClasses', () => {
    test('extracts classes from HTML', () => {
        const content = '<div class="font-bold text-center">Test</div>';
        const classes = extractClasses(content);
        expect(classes.has('font-bold')).toBe(true);
        expect(classes.has('text-center')).toBe(true);
    });

    test('extracts classes from PHP', () => {
        const content = '<div class="<?php echo $isBold ? \'font-bold\' : \'\'; ?> text-center">Test</div>';
        const classes = extractClasses(content);
        expect(classes.has('font-bold')).toBe(true);
        expect(classes.has('text-center')).toBe(true);
    });

    test('extracts classes from JSX template literals', () => {
        const content = '<div className={`text-center ${true ? "font-bold" : ""}`}>Test</div>';
        const classes = extractClasses(content);
        expect(classes.has('font-bold')).toBe(true);
        expect(classes.has('text-center')).toBe(true);
    });

    test('handles empty or invalid content', () => {
        const content = '';
        const classes = extractClasses(content);
        expect(classes.size).toBe(0);
    });
});