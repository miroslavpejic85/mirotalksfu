const sinon = require('sinon');

describe('test-OpenRedirect', function () {
    let req, res, next, log;

    beforeEach(() => {
        req = { path: '', url: '', headers: {}, body: {} };
        res = {
            status: sinon.stub().returnsThis(),
            send: sinon.stub(),
            redirect: sinon.stub(),
        };
        next = sinon.spy();
        log = { error: sinon.spy() }; // Mock the logger
    });

    // Middleware function to test
    const middleware = (err, req, res, next) => {
        if (err && (err instanceof SyntaxError || err.status === 400 || 'body' in err)) {
            log.error('Request Error', {
                header: req.headers,
                body: req.body,
                error: err.message,
            });
            return res.status(400).send({ status: 404, message: err.message }); // Bad request
        }

        // Prevent open redirect attacks by checking if the path is an external domain
        const cleanPath = req.path.replace(/^\/+/, '');
        if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/.test(cleanPath)) {
            return res.status(400).send('Bad Request: Potential Open Redirect Detected');
        }

        if (req.path.endsWith('/') && req.path.length > 1) {
            let query = req.url.substring(req.path.length).replace(/\/$/, ''); // Ensure query params don't end in '/'
            return res.redirect(301, req.path.slice(0, -1) + query);
        }

        next();
    };

    it('should prevent open redirect attempts', function () {
        req.path = '//google.com/';

        middleware(null, req, res, next);

        res.status.calledOnceWithExactly(400).should.be.true();
        res.send.calledOnceWithExactly('Bad Request: Potential Open Redirect Detected').should.be.true();
    });

    it('should handle query parameters correctly when removing trailing slash', function () {
        req.path = '/join/';
        req.url = '/join/?room=4b874c64-a8bd-4a82-a91e-53acc420b4b3uch/';

        middleware(null, req, res, next);

        res.redirect.calledOnce.should.be.true();
        res.redirect.calledWith(301, '/join?room=4b874c64-a8bd-4a82-a91e-53acc420b4b3uch').should.be.true();
    });

    it('should handle query parameters correctly', function () {
        req.path = '/join/';
        req.url = '/join/?room=123';

        middleware(null, req, res, next);

        res.redirect.calledOnce.should.be.true();
        res.redirect.calledWith(301, '/join?room=123').should.be.true();
    });

    it('should handle query parameters correctly', function () {
        req.path = '/join/';
        req.url =
            '/join/?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=1&duration=00:00:30';

        middleware(null, req, res, next);

        res.redirect.calledOnce.should.be.true();
        res.redirect
            .calledWith(
                301,
                '/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=1&duration=00:00:30',
            )
            .should.be.true();
    });

    it('should handle query parameters with token', function () {
        req.path = '/join/';
        req.url =
            '/join/?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=0&token=token';

        middleware(null, req, res, next);

        res.redirect.calledOnce.should.be.true();
        res.redirect
            .calledWith(
                301,
                '/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=0&token=token',
            )
            .should.be.true();
    });

    it('should call next() if no conditions are met', function () {
        req.path = '/valid-path';
        req.url = '/valid-path';

        middleware(null, req, res, next);

        next.calledOnce.should.be.true();
    });
});
