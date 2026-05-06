from chasemapper import predictor


def test_predictor_download_model_success():
    messages = []

    def cb(msg):
        messages.append(msg)

    predictor.model_download_running = False
    # 'true' command should exit with code 0 on POSIX systems
    predictor.predictor_download_model("true", cb)

    assert messages == ["OK"]


def test_predictor_download_model_failure():
    messages = []

    def cb(msg):
        messages.append(msg)

    predictor.model_download_running = False
    # 'false' returns non-zero
    predictor.predictor_download_model("false", cb)

    assert messages
    assert messages[0].startswith("Error")
