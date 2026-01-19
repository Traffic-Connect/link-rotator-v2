const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map(e => ({
            field: e.path,
            message: e.message
        }));
        return res.status(400).json({
            error: 'Validation error',
            details: errors
        });
    }

    // Mongoose duplicate key error
    if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        return res.status(400).json({
            error: 'Duplicate error',
            message: `${field} already exists`
        });
    }

    // Mongoose cast error (invalid ObjectId)
    if (err.name === 'CastError') {
        return res.status(400).json({
            error: 'Invalid ID format'
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            error: 'Invalid token'
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            error: 'Token expired'
        });
    }

    // Default error
    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Internal server error';

    const payload = {
        error: message
    };

    if (err.messages && err.messages.length) {
        payload.messages = err.messages;
    }

    if (err.details && err.details.length) {
        payload.details = err.details;
    }

    if (process.env.NODE_ENV === 'development' && err.stack) {
        payload.stack = err.stack;
    }

    res.status(statusCode).json(payload);
};

module.exports = { errorHandler };
