const mongoose = require('mongoose');

const cloudflareCredentialSchema = new mongoose.Schema({
    label: {
        type: String,
        required: true,
        trim: true
    },
    login: {
        type: String,
        required: true,
        trim: true
    },
    password: {
        type: String,
        required: true,
        trim: true,
        select: false
    },
    apiToken: {
        type: String,
        required: true,
        select: false
    },
    accountId: {
        type: String,
        required: true,
        trim: true
    },
    accountName: {
        type: String,
        default: '',
        trim: true
    },
    lastVerifiedAt: {
        type: Date
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

cloudflareCredentialSchema.pre('save', function(next) {
    if (!this.label) {
        this.label = this.login;
    }
    next();
});

cloudflareCredentialSchema.index({ apiToken: 1 }, { unique: true });
cloudflareCredentialSchema.index({ login: 1, accountId: 1 }, { unique: true });

const CloudflareCredential = mongoose.model('CloudflareCredential', cloudflareCredentialSchema);

module.exports = CloudflareCredential;
