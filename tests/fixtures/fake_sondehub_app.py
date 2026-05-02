from flask import Flask, jsonify, request

app = Flask(__name__)


@app.route('/tawhiri', methods=['GET', 'POST'])
def tawhiri():
    # Simple canned response for predictor-related tests
    return jsonify({
        'status': 'ok',
        'predictions': [],
    })


@app.route('/sondehub/<path:subpath>', methods=['GET', 'POST'])
def sondehub(subpath):
    # Echo back request information for verification in tests
    return jsonify({
        'status': 'ok',
        'path': subpath,
        'method': request.method,
        'args': request.args,
        'json': request.get_json(silent=True),
    })


def run(port: int = 5002, host: str = '127.0.0.1'):
    app.run(host=host, port=port)


if __name__ == '__main__':
    run()
