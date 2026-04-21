<p align="center">
    <img align="center" src="./static/assets/wikipedia-on-ipfs.png" width="200" height="200" alt="Wikipedia on IPFS (credit: https://en.wikipedia-on-ipfs.org/wiki/)"></img>
</p>
<h1 align="center">wiki.p2plabs.xyz</h1>

IPFS Wikipedia Search is a lightweight, open-source search interface that lets you browse [Wikipedia](https://www.wikipedia.org/) over the InterPlanetary File System ([IPFS](https://ipfs.tech/)). It automatically adapts to your browser's capabilities: in P2P-enabled browsers (like [Peersky](https://peersky.p2plabs.xyz/) or any IPFS-native environment), it utilizes the native IPNS protocol (e.g., using URLs such as `ipns://en.wikipedia-on-ipfs.org/wiki/Article_Title`) to access distributed Wikipedia snapshots directly from the decentralized network. In non-P2P browsers, it falls back to an HTTP gateway (e.g., `https://en-wikipedia--on--ipfs-org.ipns.dweb.link/wiki/Article_Title`), ensuring that anyone can access the content regardless of their browser setup. The interface resolves queries via the official Wikipedia API to ensure the correct, canonical article titles before fetching it from P2P. Special thanks to [distributed-wikipedia-mirror](https://github.com/ipfs/distributed-wikipedia-mirror/) for putting Wikipedia snapshots on IPFS, which powers this project.

Know a p2p web browser that supports native `ipfs/ipns` protocols? Please add it [here](./script.js#L11).
