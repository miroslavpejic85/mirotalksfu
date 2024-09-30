class GlobalVars {
    static reasonWeights = {
        "blacklisted user": 500,
        "all-caps title": 100,
        "repeating characters in body": 50
    };

    static updateReasonWeights() {
        this.reasonWeights["spam"] = 200;
    }
}

class Post {
    constructor(postId, postUrl, userUrl, postSite, title, body) {
        this.postId = postId;
        this.postUrl = postUrl;
        this.userUrl = userUrl;
        this.postSite = postSite;
        this.title = title;
        this.body = body;
        this.isAnswer = false;
        this.edited = false;
        this.upVoteCount = 0;
        this.downVoteCount = 0;
        this.ownerRep = 0;
        this.postScore = 0;
    }
}

function isWhitelistedUser(userUrl) {
    return false;
}

function isBlacklistedUser(userUrl) {
    return false;
}

function sumWeight(reasons) {
    if (Object.keys(GlobalVars.reasonWeights).length === 0) {
        GlobalVars.updateReasonWeights();
    }

    let sum = 0;
    reasons.forEach(reason => {
        if (reason.includes("(")) {
            reason = reason.replace(/\s*\(.*$/, "");
        }
        sum += GlobalVars.reasonWeights[reason.toLowerCase()] || 0;
    });
    return sum;
}

function checkIfSpam(post, reasons) {
    let isSpam = false;
    let why = "";

    if (isBlacklistedUser(post.userUrl)) {
        reasons.push("blacklisted user");
        why += "User is blacklisted";
    }

    if (post.title === post.title.toUpperCase()) {
        reasons.push("all-caps title");
    }

    if (reasons.length > 0) {
        isSpam = true;
    }

    return isSpam;
}

function buildMessage(post, reasons) {
    const messageFormat = "[SmokeDetector] %s: [%s](%s) by %s on `%s`";
    const postUrl = post.postUrl;
    const user = post.userUrl || "a deleted user";
    const title = post.title || "Unknown title";
    const site = post.postSite;
    const weight = sumWeight(reasons);
    const reasonText = reasons.join(", ");
    return `[SmokeDetector] ${reasonText}: [${title}](${postUrl}) by ${user} on \`${site}\``;
}

function main() {
    const examplePost = new Post("123", "http://example.com/post/123", "http://example.com/user/123", "example.com", "THIS IS SPAM", "Spammy content");
    const reasons = [];
    const isSpam = checkIfSpam(examplePost, reasons);

    if (isSpam) {
        const message = buildMessage(examplePost, reasons);
        console.log("Detected spam: " + message);
    } else {
        console.log("Post is not spam.");
    }
}

main();
